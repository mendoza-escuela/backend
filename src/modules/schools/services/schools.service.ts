import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { isEmail } from 'class-validator';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  MoreThan,
  SelectQueryBuilder,
} from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuthSession } from '../../auth/entities/auth-session.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import {
  CampaignSchool,
  CampaignSchoolAssignmentSource,
} from '../../campaigns/entities/campaign-school.entity';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { CampaignType } from '../../campaigns/entities/campaign-type.enum';
import { EvaluationResult } from '../../evaluation/entities/evaluation-result.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { AdminUsersService } from '../../users/services/admin-users.service';
import { UserSchool } from '../../users/entities/user-school.entity';
import { User } from '../../users/entities/user.entity';
import { AssignSchoolUserDto } from '../dto/assign-school-user.dto';
import { AdminRectifySchoolDto } from '../dto/admin-rectify-school.dto';
import { CreateSchoolDto } from '../dto/create-school.dto';
import { ListAssignableUsersQueryDto } from '../dto/list-assignable-users-query.dto';
import { ListSchoolsQueryDto } from '../dto/list-schools-query.dto';
import { UpdateSchoolDto } from '../dto/update-school.dto';
import { RectifySchoolDto } from '../dto/rectify-school.dto';
import { SchoolUserAssignmentHistory } from '../entities/school-user-assignment-history.entity';
import {
  SchoolRectification,
  SchoolRectificationSnapshot,
} from '../entities/school-rectification.entity';
import { EducationLevelCatalog } from '../entities/education-level-catalog.entity';
import { SchoolEducationLevel } from '../entities/school-education-level.entity';
import { SchoolRectificationEducationLevel } from '../entities/school-rectification-education-level.entity';
import { SchoolShiftCatalog } from '../entities/school-shift-catalog.entity';
import { School } from '../entities/school.entity';
import {
  SchoolContact,
  SchoolContactType,
} from '../entities/school-contact.entity';
import { SchoolContactDto } from '../dto/school-contact.dto';
import {
  isOfficialCatalogLabel,
  OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS,
} from '../school-rectification.catalogs';
import { schoolRectificationReadiness } from '../school-rectification-readiness';

type SelectedEducationLevel = {
  level: EducationLevelCatalog;
  enrollment: number | null;
};

type SchoolCampaignRow = {
  assignmentId: string;
  assignmentSource: CampaignSchoolAssignmentSource;
  assignedAt: Date | string;
  campaignId: string;
  campaignName: string;
  campaignType: CampaignType;
  campaignStatus: CampaignStatus;
  campaignStartsAt: Date | string;
  campaignEndsAt: Date | string;
  submissionId: string | null;
  submissionStatus: SubmissionStatus | null;
  submissionStartedAt: Date | string | null;
  submissionLastSavedAt: Date | string | null;
  submissionSubmittedAt: Date | string | null;
  resultId: string | null;
  resultCalculatedAt: Date | string | null;
  resultGeneralScore: string | number | null;
  resultStars: string | number | null;
};

@Injectable()
export class SchoolsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly adminUsersService?: AdminUsersService,
  ) {}

  async list(query: ListSchoolsQueryDto) {
    const builder = this.filteredBuilder(query)
      .select([
        'school.id',
        'school.cue',
        'school.name',
        'school.directorName',
        'school.schoolNumber',
        'school.department',
        'school.locality',
        'school.educationLevel',
        'school.managementType',
        'school.enrollment',
        'school.isActive',
      ])
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [items, total] = await builder.getManyAndCount();
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /**
   * Lista usuarios Colegio que pueden asociarse al establecimiento.
   *
   * La disponibilidad se resuelve y pagina en PostgreSQL para evitar descargar
   * usuarios ocupados y filtrar grandes colecciones en el navegador.
   */
  async listAssignableUsers(
    schoolId: string,
    query: ListAssignableUsersQueryDto,
  ) {
    if (
      !(await this.dataSource.getRepository(School).existsBy({ id: schoolId }))
    )
      throw new NotFoundException('Colegio no encontrado.');

    const builder = this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userSchools', 'assignment')
      .leftJoinAndSelect('assignment.school', 'assignedSchool')
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.isActive',
        'assignment.userId',
        'assignment.schoolId',
        'assignedSchool.id',
        'assignedSchool.cue',
        'assignedSchool.name',
      ])
      .where('user.role = :role', { role: UserRole.School })
      .andWhere('user.isActive = true')
      .orderBy('user.lastName', 'ASC')
      .addOrderBy('user.firstName', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.search) {
      builder.andWhere(
        `(LOWER(user.firstName) LIKE :search OR LOWER(user.lastName) LIKE :search OR LOWER(user.email) LIKE :search)`,
        { search: `%${query.search.toLowerCase()}%` },
      );
    }

    const [users, total] = await builder.getManyAndCount();
    return {
      items: users.map((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        isActive: user.isActive,
        assignedSchool: user.userSchools?.[0]?.school
          ? {
              id: user.userSchools[0].school.id,
              cue: user.userSchools[0].school.cue,
              name: user.userSchools[0].school.name,
            }
          : null,
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async filterOptions() {
    const [
      departments,
      localities,
      educationLevels,
      managementTypes,
      scopes,
      shifts,
    ] = await Promise.all([
      this.distinctValues('department'),
      this.distinctValues('locality'),
      this.distinctValues('educationLevel'),
      this.distinctValues('managementType'),
      this.distinctValues('scope'),
      this.distinctValues('shift'),
    ]);
    return {
      departments,
      localities,
      educationLevels,
      managementTypes,
      scopes,
      shifts,
    };
  }

  async findOne(id: string) {
    const school = await this.dataSource.getRepository(School).findOne({
      where: { id },
      relations: {
        shiftCatalog: true,
        structuredEducationLevels: { level: true },
        contacts: true,
      },
      order: { structuredEducationLevels: { order: 'ASC' } },
    });
    if (!school) throw new NotFoundException('Colegio no encontrado.');
    const users = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .innerJoin(
        'user.userSchools',
        'assignment',
        'assignment.schoolId = :id',
        { id },
      )
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.role',
        'user.isActive',
        'user.lastLoginAt',
      ])
      .getMany();
    const userIds = users.map((user) => user.id);
    const accesses = userIds.length
      ? await this.dataSource
          .getRepository(AuthSession)
          .createQueryBuilder('session')
          .leftJoin('session.user', 'user')
          .select([
            'session.id',
            'session.userId',
            'session.createdAt',
            'session.expiresAt',
            'session.revokedAt',
            'user.firstName',
            'user.lastName',
            'user.email',
          ])
          .where('session.userId IN (:...userIds)', { userIds })
          .orderBy('session.createdAt', 'DESC')
          .take(20)
          .getMany()
      : [];
    const assignmentHistory = await this.dataSource
      .getRepository(SchoolUserAssignmentHistory)
      .find({
        where: { schoolId: id },
        relations: { previousUser: true, newUser: true, actorUser: true },
        order: { createdAt: 'DESC' },
        take: 50,
      });
    const audits = await this.dataSource.getRepository(AuditLog).find({
      where: { entityType: 'School', entityId: id },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const rectifications = await this.rectificationHistory(id);
    const rectificationStatus = this.rectificationStatus(rectifications);
    const participation = await this.schoolCampaignParticipation(id);
    return {
      ...this.serializeSchool(school),
      rectification: rectificationStatus,
      rectifications: rectifications.map((rectification) => ({
        id: rectification.id,
        periodYear: rectification.periodYear,
        rectifiedAt: rectification.rectifiedAt,
        actorUser: this.userSummary(rectification.actorUser),
        snapshot: rectification.snapshot,
      })),
      users: users.map((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
      })),
      accesses,
      assignmentHistory: assignmentHistory.map((history) => ({
        id: history.id,
        action: history.action,
        createdAt: history.createdAt,
        previousUser: this.userSummary(history.previousUser),
        newUser: this.userSummary(history.newUser),
        actorUser: this.userSummary(history.actorUser),
      })),
      audits,
      campaigns: participation.campaigns,
      evaluations: participation.evaluations,
      actions: {
        canEdit: true,
        canChangeStatus: true,
        canReplaceUser: true,
        canStartEvaluation:
          school.isActive && rectificationStatus.isEvaluationReady,
      },
    };
  }

  /** Devuelve únicamente el establecimiento asociado al usuario autenticado. */
  async findForUser(userId: string) {
    const association = await this.dataSource
      .getRepository(UserSchool)
      .findOne({
        where: { userId },
      });
    if (!association)
      throw new NotFoundException(
        'Tu cuenta todavía no tiene un establecimiento asociado.',
      );
    const school = await this.loadStructuredSchool(
      this.dataSource.manager,
      association.schoolId,
    );
    const rectifications = await this.rectificationHistory(
      association.schoolId,
    );
    return {
      ...this.serializeSchool(school),
      rectification: this.rectificationStatus(rectifications),
      rectifications: rectifications.map((rectification) => ({
        id: rectification.id,
        periodYear: rectification.periodYear,
        rectifiedAt: rectification.rectifiedAt,
        actorUser: this.userSummary(rectification.actorUser),
        snapshot: rectification.snapshot,
      })),
    };
  }

  /** Catálogos compartidos por backend para la rectificación escolar. */
  async rectificationCatalogsForUser(userId: string) {
    const association = await this.dataSource
      .getRepository(UserSchool)
      .findOneBy({ userId });
    if (!association)
      throw new NotFoundException(
        'Tu cuenta todavía no tiene un establecimiento asociado.',
      );
    return this.rectificationCatalogs();
  }

  async rectificationCatalogs() {
    const [shifts, educationLevels] = await Promise.all([
      this.dataSource.getRepository(SchoolShiftCatalog).find({
        order: { order: 'ASC', label: 'ASC' },
      }),
      this.dataSource.getRepository(EducationLevelCatalog).find({
        order: { order: 'ASC', label: 'ASC' },
      }),
    ]);
    return {
      shifts: {
        available: shifts.length > 0,
        message: shifts.length
          ? null
          : 'El catálogo oficial de jornadas todavía no fue configurado.',
        items: shifts.map((shift) => this.catalogSummary(shift)),
      },
      educationLevels: {
        available: educationLevels.length > 0,
        message: educationLevels.length
          ? null
          : 'El catálogo oficial de niveles educativos todavía no fue configurado.',
        items: educationLevels.map((level) => this.catalogSummary(level)),
      },
      managementTypes:
        OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.managementTypes.map(
          (option) => ({ ...option }),
        ),
      scopes: OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.scopes.map((option) => ({
        ...option,
      })),
      educationTypes: OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.educationTypes.map(
        (option) => ({
          ...option,
        }),
      ),
      characteristics:
        OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.characteristics.map(
          (option) => ({ ...option }),
        ),
    };
  }

  /**
   * Resuelve el establecimiento desde la sesión y verifica la rectificación
   * anual sin aceptar identificadores enviados por el navegador.
   */
  async evaluationContextForUser(
    userId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const association = await manager.findOne(UserSchool, {
      where: { userId },
      relations: { school: true },
    });
    if (!association)
      throw new NotFoundException(
        'Tu cuenta todavía no tiene un establecimiento asociado.',
      );
    const periodYear = this.currentPeriodYear();
    const rectification = await manager.findOne(SchoolRectification, {
      where: {
        schoolId: association.schoolId,
        periodYear,
      },
      order: { rectifiedAt: 'DESC' },
    });
    const readiness = schoolRectificationReadiness(rectification?.snapshot);
    return {
      school: association.school,
      rectification: {
        id: rectification?.id ?? null,
        periodYear,
        isConfirmed: Boolean(rectification),
        isEvaluationReady: readiness.isEvaluationReady,
        missingFields: readiness.missingFields,
        /** @deprecated Usar isEvaluationReady. */
        isRectified: readiness.isEvaluationReady,
        rectifiedAt: rectification?.rectifiedAt ?? null,
        snapshot: rectification?.snapshot ?? null,
      },
    };
  }

  /** Rectifica la ficha del colegio asociado sin aceptar IDs del navegador. */
  async rectifyForUser(actor: AuthenticatedUser, dto: RectifySchoolDto) {
    const association = await this.dataSource
      .getRepository(UserSchool)
      .findOneBy({ userId: actor.id });
    if (!association)
      throw new NotFoundException(
        'Tu cuenta todavía no tiene un establecimiento asociado.',
      );
    await this.rectify(association.schoolId, dto, actor);
    return this.findForUser(actor.id);
  }

  /**
   * Confirma los datos obligatorios para el año calendario y conserva un
   * snapshot independiente de futuras modificaciones de la ficha actual.
   */
  async rectify(
    schoolId: string,
    dto: RectifySchoolDto,
    actor: AuthenticatedUser,
  ) {
    return this.performRectification(schoolId, dto, actor);
  }

  /**
   * Rectifica desde administración y aplica los campos administrativos dentro
   * de la misma transacción que genera el snapshot histórico.
   */
  async rectifyAsAdmin(
    schoolId: string,
    dto: AdminRectifySchoolDto,
    actor: AuthenticatedUser,
  ) {
    return this.performRectification(
      schoolId,
      dto,
      actor,
      this.adminRectificationFields(dto),
    );
  }

  private async performRectification(
    schoolId: string,
    dto: RectifySchoolDto,
    actor: AuthenticatedUser,
    adminFields: Partial<
      Pick<School, 'schoolNumber' | 'postalCode' | 'phone' | 'email'>
    > = {},
  ) {
    const periodYear = this.currentPeriodYear();
    try {
      await this.dataSource.transaction(async (manager) => {
        const school = await manager.getRepository(School).findOne({
          where: { id: schoolId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!school) throw new NotFoundException('Colegio no encontrado.');
        if (!school.isActive && actor.role === UserRole.School)
          throw new ConflictException(
            'El colegio está inactivo y no puede rectificar su ficha.',
          );
        this.assertCompleteRectification(dto);
        this.assertExpectedUpdate(school, dto.expectedUpdatedAt);
        const currentStructured = await this.structuredState(manager, school);
        const normalized = {
          name: dto.name,
          cue: dto.cue.toUpperCase(),
          directorName: dto.directorName,
          department: dto.department,
          address: dto.address,
          locality: dto.locality,
          scope: dto.scope,
          educationLevel: dto.educationLevel,
          ...(dto.managementType !== undefined
            ? { managementType: dto.managementType }
            : {}),
          ...adminFields,
        };
        if (normalized.cue !== school.cue)
          await this.assertCueUnique(manager, normalized.cue, schoolId);
        const selectedShift = await this.resolveShift(
          manager,
          school,
          dto.shiftCatalogId,
          currentStructured.shiftCatalog,
        );
        const selectedLevels = await this.resolveEducationLevels(
          manager,
          schoolId,
          dto.educationLevels,
          currentStructured.educationLevels,
        );
        if (!selectedShift)
          throw new BadRequestException(
            'Debe seleccionarse una jornada del catálogo oficial.',
          );
        if (!selectedLevels.length)
          throw new BadRequestException(
            'Debe seleccionarse al menos un nivel educativo.',
          );
        const before = this.rectificationSnapshot(
          school,
          currentStructured.shiftCatalog,
          currentStructured.educationLevels,
          currentStructured.contacts,
        );
        Object.assign(school, normalized);
        school.hasKiosk = dto.hasKiosk;
        school.hasFoodService = dto.hasFoodService;
        if (dto.isBoarding !== undefined) school.isBoarding = dto.isBoarding;
        school.shiftCatalogId = selectedShift.id;
        school.shift = selectedShift.label;
        school.characteristics = this.mergeCharacteristics(
          school.characteristics,
          dto.characteristics,
        );
        if (dto.enrollment !== undefined) school.enrollment = dto.enrollment;
        await manager.save(School, school);

        const finalContacts = dto.contacts
          ? await this.replaceContacts(manager, school, dto.contacts)
          : currentStructured.contacts;

        await this.replaceEducationLevels(manager, schoolId, selectedLevels);

        const rectificationId = randomUUID();
        const capturedAt = new Date();
        const finalShift = selectedShift;
        const finalLevels = selectedLevels;
        const snapshot = this.rectificationSnapshot(
          school,
          finalShift,
          finalLevels,
          finalContacts,
          rectificationId,
          capturedAt,
        );
        const rectification = await manager.save(SchoolRectification, {
          id: rectificationId,
          schoolId,
          periodYear,
          actorUserId: actor.id,
          snapshot,
          rectifiedAt: capturedAt,
        });
        if (finalLevels.length)
          await manager.save(
            SchoolRectificationEducationLevel,
            finalLevels.map((selected, order) =>
              manager.create(SchoolRectificationEducationLevel, {
                rectificationId,
                levelId: selected.level.id,
                levelCode: selected.level.code,
                levelLabel: selected.level.label,
                enrollment: selected.enrollment,
                order,
              }),
            ),
          );
        await this.audit(manager, actor.id, 'SCHOOL_RECTIFIED', schoolId, {
          periodYear,
          rectificationId: rectification.id,
          changes: this.diff(
            before,
            this.rectificationSnapshot(
              school,
              finalShift,
              finalLevels,
              finalContacts,
            ),
          ),
          snapshot,
        });
      });
      return this.findOne(schoolId);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async create(dto: CreateSchoolDto, actor: AuthenticatedUser) {
    if (!dto.referentEmail?.trim()) {
      throw new BadRequestException({
        code: 'RESPONSIBLE_EMAIL_REQUIRED',
        field: 'referentEmail',
        message: 'Ingresá el correo del referente responsable.',
      });
    }
    const normalized = this.normalize(dto);
    const requestedContacts = normalized.contacts;
    const requestedEducationLevels = normalized.educationLevels;
    delete (normalized as Partial<CreateSchoolDto>).contacts;
    delete (normalized as Partial<CreateSchoolDto>).educationLevels;
    this.validateCharacteristics(normalized.characteristics);
    const temporaryPassword = this.generateTemporaryPassword();
    try {
      const created = await this.dataSource.transaction(async (manager) => {
        await this.assertCueUnique(manager, normalized.cue);
        const selectedShift = await this.resolveShift(
          manager,
          { shiftCatalogId: null } as School,
          normalized.shiftCatalogId,
          null,
        );
        const selectedLevels = await this.resolveEducationLevels(
          manager,
          '',
          requestedEducationLevels,
          [],
        );
        if (selectedShift) {
          normalized.shiftCatalogId = selectedShift.id;
          normalized.shift = selectedShift.label;
        }
        const school = await manager.save(
          School,
          manager.create(School, normalized),
        );
        if (requestedEducationLevels !== undefined)
          await this.replaceEducationLevels(manager, school.id, selectedLevels);
        const finalContacts = await this.replaceContacts(
          manager,
          school,
          requestedContacts ?? [this.legacyRespondentContact(school)],
        );
        await this.audit(
          manager,
          actor.id,
          'SCHOOL_CREATED',
          school.id,
          this.administrativeSnapshot(
            school,
            selectedShift,
            selectedLevels,
            finalContacts,
          ),
        );
        const responsibleUser = this.adminUsersService
          ? await this.adminUsersService.createInTransaction(
              manager,
              {
                firstName: normalized.referentFirstName,
                lastName: normalized.referentLastName,
                email: normalized.referentEmail!,
                role: UserRole.School,
                schoolId: school.id,
                temporaryPassword,
                isActive: normalized.isActive ?? true,
              },
              actor,
            )
          : null;
        return { schoolId: school.id, responsibleUser };
      });
      const invitationEmailSent = created.responsibleUser
        ? await this.adminUsersService!.sendInvitation(
            created.responsibleUser.id,
            {
              firstName: created.responsibleUser.firstName,
              lastName: created.responsibleUser.lastName,
              email: created.responsibleUser.email,
              temporaryPassword,
            },
          )
        : false;
      return {
        ...(await this.findOne(created.schoolId)),
        responsibleUserInvitationEmailSent: invitationEmailSent,
      };
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async update(id: string, dto: UpdateSchoolDto, actor: AuthenticatedUser) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const school = await manager
          .getRepository(School)
          .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!school) throw new NotFoundException('Colegio no encontrado.');
        const normalized = this.normalize(dto);
        const requestedContacts = normalized.contacts;
        const requestedEducationLevels = normalized.educationLevels;
        delete (normalized as Partial<UpdateSchoolDto>).contacts;
        delete (normalized as Partial<UpdateSchoolDto>).educationLevels;
        if (normalized.cue && normalized.cue !== school.cue)
          await this.assertCueUnique(manager, normalized.cue, id);
        if (normalized.characteristics)
          this.validateCharacteristics(normalized.characteristics);
        const currentStructured = await this.structuredState(manager, school);
        const before = this.administrativeSnapshot(
          school,
          currentStructured.shiftCatalog,
          currentStructured.educationLevels,
          currentStructured.contacts,
        );
        const mergedCharacteristics = this.mergeCharacteristics(
          school.characteristics,
          normalized.characteristics,
        );
        const selectedShift = await this.resolveShift(
          manager,
          school,
          normalized.shiftCatalogId,
          currentStructured.shiftCatalog,
        );
        const selectedLevels = await this.resolveEducationLevels(
          manager,
          id,
          requestedEducationLevels,
          currentStructured.educationLevels,
        );
        if (normalized.shiftCatalogId !== undefined) {
          normalized.shiftCatalogId = selectedShift?.id ?? null;
          if (selectedShift) normalized.shift = selectedShift.label;
        }
        Object.assign(school, normalized);
        school.characteristics = mergedCharacteristics;
        await manager.save(School, school);
        if (requestedEducationLevels !== undefined)
          await this.replaceEducationLevels(manager, id, selectedLevels);
        const finalContacts =
          requestedContacts !== undefined
            ? await this.replaceContacts(manager, school, requestedContacts)
            : currentStructured.contacts;
        const changes = this.diff(
          before,
          this.administrativeSnapshot(
            school,
            selectedShift,
            selectedLevels,
            finalContacts,
          ),
        );
        if (Object.keys(changes).length)
          await this.audit(manager, actor.id, 'SCHOOL_UPDATED', id, changes);
      });
      return this.findOne(id);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async setStatus(id: string, isActive: boolean, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const school = await manager
        .getRepository(School)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!school) throw new NotFoundException('Colegio no encontrado.');

      // Una segunda baja sigue conciliando sesiones por seguridad. Al reactivar
      // también se cierran SIDs legados para que sólo un nuevo login otorgue
      // acceso. Active→active permanece como un no-op real.
      const statusChanged = school.isActive !== isActive;
      const revokedSessionsCount =
        !isActive || statusChanged
          ? await this.revokeActiveSchoolSessions(manager, id, new Date())
          : 0;
      if (school.isActive === isActive) {
        if (!isActive && revokedSessionsCount > 0)
          await this.audit(manager, actor.id, 'SCHOOL_SESSIONS_REVOKED', id, {
            isActive: { from: false, to: false },
            newEvaluationsAllowed: false,
            revokedSessionsCount,
          });
        return;
      }

      school.isActive = isActive;
      await manager.save(School, school);
      await this.audit(
        manager,
        actor.id,
        isActive ? 'SCHOOL_ACTIVATED' : 'SCHOOL_DEACTIVATED',
        id,
        {
          isActive: { from: !isActive, to: isActive },
          newEvaluationsAllowed: isActive,
          revokedSessionsCount,
        },
      );
    });
    return this.findOne(id);
  }

  /**
   * Revoca solamente sesiones vigentes de los usuarios asociados sin alterar
   * la asociación ni el estado propio de esas cuentas.
   */
  private async revokeActiveSchoolSessions(
    manager: EntityManager,
    schoolId: string,
    revokedAt: Date,
  ) {
    const assignments = await manager.find(UserSchool, {
      select: { userId: true },
      where: { schoolId },
    });
    const userIds = assignments.map(({ userId }) => userId);
    if (!userIds.length) return 0;

    const update = await manager.update(
      AuthSession,
      {
        userId: In(userIds),
        revokedAt: IsNull(),
        expiresAt: MoreThan(revokedAt),
      },
      { revokedAt },
    );
    return update.affected ?? 0;
  }

  /** Valida en backend que un colegio pueda iniciar una nueva evaluación. */
  async assertActiveForEvaluation(
    schoolId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const school = await manager.getRepository(School).findOne({
      where: { id: schoolId },
      lock: manager.queryRunner?.isTransactionActive
        ? { mode: 'pessimistic_read' }
        : undefined,
    });
    if (!school) throw new NotFoundException('Colegio no encontrado.');
    if (!school.isActive)
      throw new ConflictException(
        'El colegio está inactivo y no puede realizar cargas ni evaluaciones.',
      );
    return school;
  }

  async assignUser(
    id: string,
    dto: AssignSchoolUserDto,
    actor: AuthenticatedUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const school = await manager
        .getRepository(School)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!school) throw new NotFoundException('Colegio no encontrado.');
      const current = await manager.findOneBy(UserSchool, { schoolId: id });
      if (current?.userId === dto.userId) return;
      let next: User | null = null;
      if (dto.userId) {
        next = await manager.getRepository(User).findOne({
          where: { id: dto.userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!next || next.role !== UserRole.School)
          throw new BadRequestException(
            'Sólo puede asociarse un usuario con rol Colegio.',
          );
        if (!next.isActive)
          throw new BadRequestException(
            'El usuario seleccionado está bloqueado.',
          );
        const otherAssignment = await manager.findOneBy(UserSchool, {
          userId: next.id,
        });
        if (otherAssignment && otherAssignment.schoolId !== id) {
          await manager.delete(UserSchool, { userId: next.id });
          await manager.save(SchoolUserAssignmentHistory, {
            schoolId: otherAssignment.schoolId,
            previousUserId: next.id,
            newUserId: null,
            actorUserId: actor.id,
            action: 'unassigned',
          });
          await this.audit(
            manager,
            actor.id,
            'SCHOOL_USER_UNASSIGNED',
            otherAssignment.schoolId,
            { userId: { from: next.id, to: null }, movedToSchoolId: id },
          );
        }
      }
      if (current) await manager.delete(UserSchool, { schoolId: id });
      if (next)
        await manager.save(UserSchool, { schoolId: id, userId: next.id });
      const action = !next ? 'unassigned' : current ? 'replaced' : 'assigned';
      await manager.save(SchoolUserAssignmentHistory, {
        schoolId: id,
        previousUserId: current?.userId ?? null,
        newUserId: next?.id ?? null,
        actorUserId: actor.id,
        action,
      });
      await this.audit(
        manager,
        actor.id,
        'SCHOOL_USER_' + action.toUpperCase(),
        id,
        { userId: { from: current?.userId ?? null, to: next?.id ?? null } },
      );
    });
    return this.findOne(id);
  }

  async export(
    query: ListSchoolsQueryDto,
    format: 'csv' | 'xlsx',
    actor: AuthenticatedUser,
  ) {
    const schools = await this.filteredBuilder(query)
      .select([
        'school.id',
        'school.cue',
        'school.name',
        'school.directorName',
        'school.schoolNumber',
        'school.department',
        'school.locality',
        'school.address',
        'school.postalCode',
        'school.educationLevel',
        'school.managementType',
        'school.scope',
        'school.shift',
        'school.email',
        'school.phone',
        'school.referentFirstName',
        'school.referentLastName',
        'school.referentEmail',
        'school.referentPhone',
        'school.enrollment',
        'school.isActive',
      ])
      .getMany();
    const currentYear = this.currentPeriodYear();
    const contacts = schools.length
      ? await this.dataSource.getRepository(SchoolContact).find({
          where: { schoolId: In(schools.map(({ id }) => id)) },
        })
      : [];
    const contactsBySchool = new Map<string, SchoolContact[]>();
    contacts.forEach((contact) =>
      contactsBySchool.set(contact.schoolId, [
        ...(contactsBySchool.get(contact.schoolId) ?? []),
        contact,
      ]),
    );
    const rectifiedRows = schools.length
      ? await this.dataSource
          .getRepository(SchoolRectification)
          .createQueryBuilder('rectification')
          .select('rectification.schoolId', 'schoolId')
          .addSelect('MAX(rectification.rectifiedAt)', 'rectifiedAt')
          .where('rectification.schoolId IN (:...schoolIds)', {
            schoolIds: schools.map((school) => school.id),
          })
          .andWhere('rectification.periodYear = :currentYear', { currentYear })
          .groupBy('rectification.schoolId')
          .getRawMany<{ schoolId: string; rectifiedAt: Date }>()
      : [];
    const rectifiedBySchool = new Map(
      rectifiedRows.map((row) => [row.schoolId, row.rectifiedAt]),
    );
    await this.dataSource.getRepository(AuditLog).save({
      actorUserId: actor.id,
      action: 'SCHOOLS_EXPORTED',
      entityType: 'School',
      entityId: null,
      changes: { format, count: schools.length, filters: query },
    });
    const headers = [
      'CUE',
      'Nombre',
      'Director/a',
      'Número',
      'Departamento',
      'Localidad',
      'Dirección',
      'Código postal',
      'Nivel',
      'Gestión',
      'Ámbito',
      'Jornada',
      'Correo',
      'Teléfono',
      'Referente responsable',
      'Cargo responsable',
      'Correo responsable',
      'Teléfono responsable',
      'Matrícula',
      'Estado',
      'Período de rectificación',
      'Rectificada',
      'Fecha de rectificación',
    ];
    const rows = schools.map((school) => {
      const schoolContacts = contactsBySchool.get(school.id) ?? [];
      const respondent = schoolContacts.find(
        ({ type }) => type === SchoolContactType.Respondent,
      );
      return [
        school.cue,
        school.name,
        school.directorName,
        school.schoolNumber ?? '',
        school.department,
        school.locality,
        school.address,
        school.postalCode ?? '',
        school.educationLevel,
        school.managementType,
        school.scope ?? '',
        school.shift ?? '',
        school.email ?? '',
        school.phone ?? '',
        respondent
          ? `${respondent.lastName}, ${respondent.firstName}`
          : `${school.referentLastName}, ${school.referentFirstName}`,
        respondent?.position ?? '',
        respondent?.email ?? school.referentEmail ?? '',
        respondent?.phone ?? school.referentPhone ?? '',
        school.enrollment,
        school.isActive ? 'Activo' : 'Inactivo',
        currentYear,
        rectifiedBySchool.has(school.id) ? 'Sí' : 'No',
        rectifiedBySchool.get(school.id)?.toISOString() ?? '',
      ];
    });
    if (format === 'csv')
      return {
        buffer: Buffer.from(
          '\uFEFF' +
            [headers, ...rows]
              .map((row) =>
                row.map((value) => this.csvCell(String(value))).join(','),
              )
              .join('\r\n'),
          'utf8',
        ),
        mime: 'text/csv; charset=utf-8',
        extension: 'csv',
      };
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Padrón');
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000F9F' },
    };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = 20;
    });
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }

  private filteredBuilder(
    query: ListSchoolsQueryDto,
  ): SelectQueryBuilder<School> {
    const builder = this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .orderBy('school.name', 'ASC');
    if (query.search?.trim())
      builder.andWhere(
        "(LOWER(school.cue) LIKE :search OR LOWER(school.name) LIKE :search OR LOWER(COALESCE(school.schoolNumber, '')) LIKE :search)",
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    for (const key of [
      'department',
      'locality',
      'educationLevel',
      'managementType',
      'scope',
      'shift',
    ] as const)
      if (query[key])
        builder.andWhere(`school.${key} = :${key}`, { [key]: query[key] });
    if (query.isActive !== undefined)
      builder.andWhere('school.isActive = :isActive', {
        isActive: query.isActive,
      });
    return builder;
  }

  private async distinctValues(
    column:
      | 'department'
      | 'locality'
      | 'educationLevel'
      | 'managementType'
      | 'scope'
      | 'shift',
  ) {
    const rows = await this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .select(`DISTINCT school.${column}`, 'value')
      .where(`school.${column} IS NOT NULL`)
      .andWhere(`school.${column} <> ''`)
      .orderBy(`school.${column}`, 'ASC')
      .getRawMany<{ value: string }>();
    return rows.map((row) => row.value);
  }

  private normalize<T extends CreateSchoolDto | UpdateSchoolDto>(dto: T) {
    const normalized = { ...dto } as Record<string, unknown>;
    if (typeof normalized.cue === 'string')
      normalized.cue = normalized.cue.toUpperCase();
    for (const key of ['email', 'referentEmail'])
      if (typeof normalized[key] === 'string')
        normalized[key] = normalized[key].toLowerCase();
    for (const key of [
      'schoolNumber',
      'postalCode',
      'scope',
      'shift',
      'phone',
      'email',
      'referentEmail',
      'referentPhone',
    ])
      if (normalized[key] === undefined) delete normalized[key];
    return normalized as T;
  }

  private validateCharacteristics(value: Record<string, unknown> | undefined) {
    if (!value) return;
    const entries = Object.entries(value);
    if (
      entries.length > 30 ||
      entries.some(
        ([key, item]) =>
          key.length > 80 ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          (!['string', 'number', 'boolean'].includes(typeof item) &&
            item !== null),
      )
    )
      throw new BadRequestException(
        'Las características deben contener hasta 30 valores simples.',
      );
  }

  /**
   * Fusiona únicamente valores informados y conserva `null` como limpieza
   * explícita de una característica previamente conocida.
   */
  private mergeCharacteristics(
    current: School['characteristics'] | null | undefined,
    updates: object | undefined,
  ): School['characteristics'] {
    if (!updates) return { ...(current ?? {}) };
    const informedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    );
    return { ...(current ?? {}), ...informedUpdates };
  }

  private adminRectificationFields(
    dto: AdminRectifySchoolDto,
  ): Partial<Pick<School, 'schoolNumber' | 'postalCode' | 'phone' | 'email'>> {
    const fields: Partial<
      Pick<School, 'schoolNumber' | 'postalCode' | 'phone' | 'email'>
    > = {};
    const normalizedText = (value: string | null) =>
      value === null ? null : value.trim().replace(/\s+/g, ' ') || null;
    if (dto.schoolNumber !== undefined)
      fields.schoolNumber = normalizedText(dto.schoolNumber);
    if (dto.postalCode !== undefined)
      fields.postalCode = normalizedText(dto.postalCode);
    if (dto.phone !== undefined) fields.phone = normalizedText(dto.phone);
    if (dto.email !== undefined) {
      const email = normalizedText(dto.email);
      fields.email = email?.toLowerCase() ?? null;
    }
    return fields;
  }

  private async assertCueUnique(
    manager: EntityManager,
    cue: string,
    exceptId?: string,
  ) {
    const builder = manager
      .getRepository(School)
      .createQueryBuilder('school')
      .where('LOWER(school.cue) = :cue', { cue: cue.toLowerCase() });
    if (exceptId) builder.andWhere('school.id <> :exceptId', { exceptId });
    if (await builder.getExists())
      throw new ConflictException('Ya existe un colegio con ese CUE.');
  }
  private snapshot(school: School) {
    return {
      cue: school.cue,
      name: school.name,
      directorName: school.directorName,
      schoolNumber: school.schoolNumber,
      department: school.department,
      locality: school.locality,
      address: school.address,
      postalCode: school.postalCode,
      educationLevel: school.educationLevel,
      managementType: school.managementType,
      scope: school.scope,
      shift: school.shift,
      shiftCatalogId: school.shiftCatalogId,
      phone: school.phone,
      email: school.email,
      referentFirstName: school.referentFirstName,
      referentLastName: school.referentLastName,
      referentEmail: school.referentEmail,
      referentPhone: school.referentPhone,
      enrollment: school.enrollment,
      hasKiosk: school.hasKiosk,
      hasFoodService: school.hasFoodService,
      isBoarding: school.isBoarding,
      characteristics: { ...(school.characteristics ?? {}) },
      isActive: school.isActive,
    };
  }

  /** Captura las relaciones estructuradas usadas por la ficha institucional. */
  private structuredProfileSnapshot(
    shiftCatalog: SchoolShiftCatalog | null,
    educationLevels: SelectedEducationLevel[],
    contacts: SchoolContact[],
  ) {
    return {
      shiftCatalog: shiftCatalog
        ? {
            id: shiftCatalog.id,
            code: shiftCatalog.code,
            label: shiftCatalog.label,
          }
        : null,
      educationLevels: educationLevels.map(({ level, enrollment }) => ({
        id: level.id,
        code: level.code,
        label: level.label,
        enrollment,
      })),
      contacts: contacts
        .slice()
        .sort((left, right) => left.type.localeCompare(right.type))
        .map(({ type, firstName, lastName, position, phone, email }) => ({
          type,
          firstName,
          lastName,
          position,
          phone,
          email,
        })),
    };
  }

  private administrativeSnapshot(
    school: School,
    shiftCatalog: SchoolShiftCatalog | null,
    educationLevels: SelectedEducationLevel[],
    contacts: SchoolContact[],
  ) {
    return {
      ...this.snapshot(school),
      ...this.structuredProfileSnapshot(
        shiftCatalog,
        educationLevels,
        contacts,
      ),
    };
  }

  /**
   * Construye una copia autocontenida. Los nombres visibles se copian para que
   * un cambio posterior de catálogo no reescriba la historia.
   */
  private rectificationSnapshot(
    school: School,
    shiftCatalog: SchoolShiftCatalog | null,
    educationLevels: SelectedEducationLevel[],
    contacts: SchoolContact[],
    sourceRectificationId?: string,
    capturedAt?: Date,
  ): SchoolRectificationSnapshot {
    return {
      ...(sourceRectificationId
        ? {
            schemaVersion: 4,
            sourceRectificationId,
            capturedAt: (capturedAt ?? new Date()).toISOString(),
          }
        : {}),
      name: school.name,
      cue: school.cue,
      schoolNumber: school.schoolNumber,
      directorName: school.directorName,
      department: school.department,
      address: school.address,
      postalCode: school.postalCode,
      locality: school.locality,
      managementType: school.managementType,
      scope: school.scope,
      educationLevel: school.educationLevel,
      shift: school.shift,
      phone: school.phone,
      email: school.email,
      hasKiosk: school.hasKiosk ?? null,
      hasFoodService: school.hasFoodService ?? null,
      isBoarding: school.isBoarding ?? null,
      characteristics: { ...school.characteristics },
      ...this.structuredProfileSnapshot(
        shiftCatalog,
        educationLevels,
        contacts,
      ),
      enrollmentTotal: school.enrollment ?? null,
    };
  }

  private async loadStructuredSchool(manager: EntityManager, schoolId: string) {
    const school = await manager.findOne(School, {
      where: { id: schoolId },
      relations: {
        shiftCatalog: true,
        structuredEducationLevels: { level: true },
        contacts: true,
      },
      order: { structuredEducationLevels: { order: 'ASC' } },
    });
    if (!school) throw new NotFoundException('Colegio no encontrado.');
    return school;
  }

  private serializeSchool(school: School) {
    const { structuredEducationLevels, contacts, ...fields } = school;
    return {
      ...fields,
      shiftCatalog: school.shiftCatalog
        ? this.catalogSummary(school.shiftCatalog)
        : null,
      educationLevels: (structuredEducationLevels ?? [])
        .sort((left, right) => left.order - right.order)
        .map((selection) => ({
          levelId: selection.levelId,
          code: selection.level.code,
          label: selection.level.label,
          isActive: selection.level.isActive,
          enrollment: selection.enrollment,
          order: selection.order,
        })),
      contacts: (contacts ?? [])
        .slice()
        .sort((left, right) => left.type.localeCompare(right.type))
        .map(({ id, type, firstName, lastName, position, phone, email }) => ({
          id,
          type,
          firstName,
          lastName,
          position,
          phone,
          email,
        })),
    };
  }

  private async structuredState(
    manager: EntityManager,
    school: School,
  ): Promise<{
    shiftCatalog: SchoolShiftCatalog | null;
    educationLevels: SelectedEducationLevel[];
    contacts: SchoolContact[];
  }> {
    const [shiftCatalog, selections, contacts] = await Promise.all([
      school.shiftCatalogId
        ? manager.findOneBy(SchoolShiftCatalog, {
            id: school.shiftCatalogId,
          })
        : Promise.resolve(null),
      manager.find(SchoolEducationLevel, {
        where: { schoolId: school.id },
        relations: { level: true },
        order: { order: 'ASC' },
      }),
      manager.find(SchoolContact, {
        where: { schoolId: school.id },
        order: { type: 'ASC' },
      }),
    ]);
    return {
      shiftCatalog,
      educationLevels: selections.map((selection) => ({
        level: selection.level,
        enrollment: selection.enrollment,
      })),
      contacts,
    };
  }

  /**
   * Reemplaza de forma atómica los dos referentes y sincroniza el referente
   * respondente con las columnas heredadas durante la ventana de transición.
   */
  private async replaceContacts(
    manager: EntityManager,
    school: School,
    contacts: SchoolContactDto[],
  ): Promise<SchoolContact[]> {
    const types = contacts.map(({ type }) => type);
    if (new Set(types).size !== types.length)
      throw new BadRequestException(
        'Sólo puede existir un referente escolar de cada tipo.',
      );
    if (!types.includes(SchoolContactType.Respondent))
      throw new BadRequestException(
        'Debe informarse el referente responsable del establecimiento.',
      );
    await manager.delete(SchoolContact, { schoolId: school.id });
    const saved = contacts.length
      ? await manager.save(
          SchoolContact,
          contacts.map((contact) =>
            manager.create(SchoolContact, {
              schoolId: school.id,
              type: contact.type,
              firstName: contact.firstName.trim(),
              lastName: contact.lastName.trim(),
              position: contact.position?.trim() || null,
              phone: contact.phone?.trim() || null,
              email: contact.email?.trim().toLowerCase() || null,
            }),
          ),
        )
      : [];
    const respondent = saved.find(
      ({ type }) => type === SchoolContactType.Respondent,
    );
    if (respondent) {
      school.referentFirstName = respondent.firstName;
      school.referentLastName = respondent.lastName;
      school.referentPhone = respondent.phone;
      school.referentEmail = respondent.email;
      await manager.update(School, school.id, {
        referentFirstName: respondent.firstName,
        referentLastName: respondent.lastName,
        referentPhone: respondent.phone,
        referentEmail: respondent.email,
      });
    }
    return saved;
  }

  private legacyRespondentContact(school: School): SchoolContactDto {
    return {
      type: SchoolContactType.Respondent,
      firstName: school.referentFirstName,
      lastName: school.referentLastName,
      phone: school.referentPhone ?? undefined,
      email: school.referentEmail ?? undefined,
    };
  }

  private async resolveShift(
    manager: EntityManager,
    school: School,
    requestedId: string | null | undefined,
    current: SchoolShiftCatalog | null,
  ) {
    if (requestedId === undefined) return current;
    if (requestedId === null) return null;
    const shift = await manager.findOneBy(SchoolShiftCatalog, {
      id: requestedId,
    });
    if (!shift)
      throw new BadRequestException(
        'La jornada seleccionada no existe en el catálogo.',
      );
    if (!shift.isActive && school.shiftCatalogId !== shift.id)
      throw new BadRequestException(
        'La jornada seleccionada está inactiva y no puede asignarse.',
      );
    return shift;
  }

  private async resolveEducationLevels(
    manager: EntityManager,
    schoolId: string,
    requested:
      Array<{ levelId: string; enrollment?: number | null }> | undefined,
    current: SelectedEducationLevel[],
  ): Promise<SelectedEducationLevel[]> {
    if (requested === undefined) return current;
    const ids = requested.map(({ levelId }) => levelId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'No se puede seleccionar dos veces el mismo nivel educativo.',
      );
    if (!ids.length) return [];
    const levels = await manager.findBy(EducationLevelCatalog, { id: In(ids) });
    if (levels.length !== ids.length)
      throw new BadRequestException(
        'Uno de los niveles educativos no existe en el catálogo.',
      );
    const currentIds = new Set(current.map(({ level }) => level.id));
    const byId = new Map(levels.map((level) => [level.id, level]));
    return requested.map(({ levelId, enrollment }) => {
      const level = byId.get(levelId);
      if (!level)
        throw new BadRequestException(
          'Uno de los niveles educativos no existe en el catálogo.',
        );
      if (!level.isActive && !currentIds.has(levelId))
        throw new BadRequestException(
          `El nivel educativo “${level.label}” está inactivo y no puede asignarse.`,
        );
      return { level, enrollment: enrollment ?? null };
    });
  }

  private async replaceEducationLevels(
    manager: EntityManager,
    schoolId: string,
    levels: SelectedEducationLevel[],
  ) {
    await manager.delete(SchoolEducationLevel, { schoolId });
    if (!levels.length) return;
    await manager.save(
      SchoolEducationLevel,
      levels.map((selected, order) =>
        manager.create(SchoolEducationLevel, {
          schoolId,
          levelId: selected.level.id,
          enrollment: selected.enrollment,
          order,
        }),
      ),
    );
  }

  /**
   * Repite en la capa de negocio las reglas mínimas que habilitan una
   * evaluación, incluso cuando el servicio es invocado sin pasar por un DTO.
   */
  private assertCompleteRectification(dto: RectifySchoolDto) {
    const requiredText = [
      dto.name,
      dto.cue,
      dto.directorName,
      dto.department,
      dto.address,
      dto.locality,
    ];
    if (
      requiredText.some(
        (value) => typeof value !== 'string' || value.trim().length < 2,
      )
    )
      throw new BadRequestException(
        'La ficha institucional contiene datos obligatorios incompletos.',
      );
    if (!isOfficialCatalogLabel('scopes', dto.scope))
      throw new BadRequestException(
        'El ámbito no pertenece al catálogo oficial.',
      );
    if (!isOfficialCatalogLabel('educationTypes', dto.educationLevel))
      throw new BadRequestException(
        'El tipo de educación no pertenece al catálogo oficial.',
      );
    if (
      dto.managementType !== undefined &&
      !isOfficialCatalogLabel('managementTypes', dto.managementType)
    )
      throw new BadRequestException(
        'El sector/gestión no pertenece al catálogo oficial.',
      );
    if (typeof dto.shiftCatalogId !== 'string' || !dto.shiftCatalogId.trim())
      throw new BadRequestException(
        'Debe seleccionarse una jornada del catálogo oficial.',
      );
    if (!Array.isArray(dto.educationLevels) || !dto.educationLevels.length)
      throw new BadRequestException(
        'Debe seleccionarse al menos un nivel educativo.',
      );
    if (
      dto.educationLevels.some(
        ({ levelId }) => typeof levelId !== 'string' || !levelId.trim(),
      )
    )
      throw new BadRequestException(
        'Los niveles educativos informados son inválidos.',
      );
    if (
      typeof dto.hasKiosk !== 'boolean' ||
      typeof dto.hasFoodService !== 'boolean'
    )
      throw new BadRequestException(
        'Deben informarse kiosco y comedor/servicio alimentario.',
      );
    if (
      dto.characteristics &&
      ((dto.characteristics.isMultigrade !== undefined &&
        dto.characteristics.isMultigrade !== null &&
        typeof dto.characteristics.isMultigrade !== 'boolean') ||
        (dto.characteristics.isInterculturalBilingual !== undefined &&
          dto.characteristics.isInterculturalBilingual !== null &&
          typeof dto.characteristics.isInterculturalBilingual !== 'boolean'))
    )
      throw new BadRequestException(
        'Las características oficiales deben informarse como verdadero, falso o sin dato.',
      );
    if (dto.contacts) {
      const contactTypes = new Set(dto.contacts.map(({ type }) => type));
      if (
        contactTypes.size !== dto.contacts.length ||
        dto.contacts.some(
          ({ type }) =>
            type !== SchoolContactType.Respondent &&
            type !== SchoolContactType.HealthPromotion,
        )
      )
        throw new BadRequestException(
          'Sólo puede existir un referente escolar de cada tipo.',
        );
      for (const contact of dto.contacts) {
        const invalidOptionalText = (value: unknown) =>
          value !== undefined &&
          value !== null &&
          (typeof value !== 'string' || value.trim().length < 2);
        if (
          [contact.firstName, contact.lastName].some(
            (value) => typeof value !== 'string' || value.trim().length < 2,
          ) ||
          invalidOptionalText(contact.position) ||
          invalidOptionalText(contact.phone) ||
          (contact.email !== undefined &&
            contact.email !== null &&
            (typeof contact.email !== 'string' || !isEmail(contact.email)))
        )
          throw new BadRequestException(
            'Los datos informados para cada referente deben ser válidos.',
          );
      }
    }
  }

  private assertExpectedUpdate(school: School, expected?: string) {
    if (!expected) return;
    const expectedTime = new Date(expected).getTime();
    const currentTime = school.updatedAt?.getTime();
    if (currentTime !== expectedTime)
      throw new ConflictException(
        'La ficha fue modificada por otro usuario. Recargá la página antes de confirmar.',
      );
  }

  private catalogSummary(catalog: SchoolShiftCatalog | EducationLevelCatalog) {
    return {
      id: catalog.id,
      code: catalog.code,
      label: catalog.label,
      isActive: catalog.isActive,
      order: catalog.order,
    };
  }

  private rectificationHistory(schoolId: string) {
    return this.dataSource.getRepository(SchoolRectification).find({
      where: { schoolId },
      relations: { actorUser: true },
      order: { rectifiedAt: 'DESC' },
      take: 50,
    });
  }

  /**
   * Recupera las asignaciones vigentes y su estado operativo en una única
   * consulta. Los IDs devueltos permiten enlazar al seguimiento y al detalle
   * histórico sin acoplar el backend a las rutas del frontend.
   */
  private async schoolCampaignParticipation(schoolId: string) {
    const rows = await this.dataSource
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .innerJoin(Campaign, 'campaign', 'campaign.id = assignment.campaignId')
      .leftJoin(
        SurveySubmission,
        'submission',
        'submission.campaignId = campaign.id AND submission.schoolId = assignment.schoolId',
      )
      .leftJoin(
        EvaluationResult,
        'result',
        'result.submissionId = submission.id',
      )
      .select('assignment.id', 'assignmentId')
      .addSelect('assignment.assignmentSource', 'assignmentSource')
      .addSelect('assignment.assignedAt', 'assignedAt')
      .addSelect('campaign.id', 'campaignId')
      .addSelect('campaign.name', 'campaignName')
      .addSelect('campaign.type', 'campaignType')
      .addSelect('campaign.status', 'campaignStatus')
      .addSelect('campaign.startsAt', 'campaignStartsAt')
      .addSelect('campaign.endsAt', 'campaignEndsAt')
      .addSelect('submission.id', 'submissionId')
      .addSelect('submission.status', 'submissionStatus')
      .addSelect('submission.startedAt', 'submissionStartedAt')
      .addSelect('submission.lastSavedAt', 'submissionLastSavedAt')
      .addSelect('submission.submittedAt', 'submissionSubmittedAt')
      .addSelect('result.id', 'resultId')
      .addSelect('result.calculatedAt', 'resultCalculatedAt')
      .addSelect('result.generalScore', 'resultGeneralScore')
      .addSelect('result.stars', 'resultStars')
      .where('assignment.schoolId = :schoolId', { schoolId })
      .andWhere('assignment.removedAt IS NULL')
      .orderBy('campaign.startsAt', 'DESC')
      .addOrderBy('assignment.assignedAt', 'DESC')
      .addOrderBy('campaign.id', 'ASC')
      .getRawMany<SchoolCampaignRow>();

    const items = rows.map((row) => ({
      assignment: {
        id: row.assignmentId,
        source: row.assignmentSource,
        assignedAt: this.isoDate(row.assignedAt),
      },
      campaign: {
        id: row.campaignId,
        name: row.campaignName,
        type: row.campaignType,
        status: row.campaignStatus,
        startsAt: this.isoDate(row.campaignStartsAt),
        endsAt: this.isoDate(row.campaignEndsAt),
      },
      participationStatus: this.schoolParticipationStatus(row),
      submission: row.submissionId
        ? {
            id: row.submissionId,
            status: row.submissionStatus as SubmissionStatus,
            startedAt: this.isoDate(row.submissionStartedAt),
            lastSavedAt: this.isoDate(row.submissionLastSavedAt),
            submittedAt: this.isoDate(row.submissionSubmittedAt),
          }
        : null,
      result: {
        available: Boolean(row.resultId),
        id: row.resultId,
        calculatedAt: this.isoDate(row.resultCalculatedAt),
      },
    }));
    const evaluations = rows.flatMap((row) =>
      row.resultId && row.submissionId
        ? [
            {
              id: row.resultId,
              campaignId: row.campaignId,
              submissionId: row.submissionId,
              calculatedAt: this.isoDate(row.resultCalculatedAt),
              generalScore: this.number(row.resultGeneralScore),
              stars: this.integer(row.resultStars),
            },
          ]
        : [],
    );

    return {
      campaigns: {
        available: true,
        items,
        message: items.length
          ? ''
          : 'El colegio no tiene asignaciones de etapa vigentes.',
      },
      evaluations: {
        available: true,
        items: evaluations,
        message: evaluations.length
          ? ''
          : 'No hay resultados de evaluación disponibles.',
      },
    };
  }

  private schoolParticipationStatus(
    row: Pick<SchoolCampaignRow, 'submissionId' | 'submissionStatus'>,
  ): 'not_started' | 'draft' | 'submitted' {
    if (!row.submissionId) return 'not_started';
    return row.submissionStatus === SubmissionStatus.Submitted
      ? 'submitted'
      : 'draft';
  }

  private number(value: string | number | null): number | null {
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private integer(value: string | number | null): number | null {
    const parsed = this.number(value);
    return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
  }

  private isoDate(value: Date | string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private rectificationStatus(rectifications: SchoolRectification[]) {
    const periodYear = this.currentPeriodYear();
    const latest = rectifications.find(
      (rectification) => rectification.periodYear === periodYear,
    );
    const readiness = schoolRectificationReadiness(latest?.snapshot);
    return {
      periodYear,
      isConfirmed: Boolean(latest),
      isEvaluationReady: readiness.isEvaluationReady,
      missingFields: readiness.missingFields,
      /** @deprecated Usar isEvaluationReady. */
      isRectified: readiness.isEvaluationReady,
      rectifiedAt: latest?.rectifiedAt ?? null,
      rectifiedBy: this.userSummary(latest?.actorUser ?? null),
    };
  }

  private currentPeriodYear() {
    return Number(
      new Intl.DateTimeFormat('en', {
        timeZone: 'America/Argentina/Mendoza',
        year: 'numeric',
      }).format(new Date()),
    );
  }
  private diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ) {
    return Object.fromEntries(
      Object.keys(after)
        .filter(
          (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
        )
        .map((key) => [
          key,
          { from: before[key] ?? null, to: after[key] ?? null },
        ]),
    );
  }
  private audit(
    manager: EntityManager,
    actorUserId: string,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    return manager.save(AuditLog, {
      actorUserId,
      action,
      entityType: 'School',
      entityId,
      changes,
    });
  }
  private rethrowUnique(error: unknown): never {
    const db = error as {
      code?: string;
      constraint?: string;
      driverError?: { code?: string; constraint?: string };
    };
    const code = db?.code ?? db?.driverError?.code;
    const constraint = db?.constraint ?? db?.driverError?.constraint;
    if (code === '23505' && constraint === 'IDX_users_email_unique')
      throw new ConflictException({
        code: 'USER_EMAIL_CONFLICT',
        field: 'referentEmail',
        message: 'Ya existe un usuario con ese correo.',
      });
    if (code === '23505')
      throw new ConflictException('Ya existe un colegio con ese CUE.');
    throw error;
  }
  private generateTemporaryPassword() {
    return `Mm9!${randomBytes(12).toString('base64url')}`;
  }
  private userSummary(user: User | null) {
    return user
      ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        }
      : null;
  }
  private csvCell(value: string) {
    const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safeValue)
      ? `"${safeValue.replace(/"/g, '""')}"`
      : safeValue;
  }
}

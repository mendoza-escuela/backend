import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { DataSource, EntityManager, In, SelectQueryBuilder } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { AuthSession } from '../../auth/entities/auth-session.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { User } from '../../users/entities/user.entity';
import { AssignSchoolUserDto } from '../dto/assign-school-user.dto';
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

type SelectedEducationLevel = {
  level: EducationLevelCatalog;
  enrollment: number | null;
};

@Injectable()
export class SchoolsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
      .leftJoin('user.userSchools', 'assignment')
      .select([
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.email',
        'user.isActive',
      ])
      .where('user.role = :role', { role: UserRole.School })
      .andWhere('user.isActive = true')
      .andWhere(
        '(assignment.userId IS NULL OR assignment.schoolId = :schoolId)',
        { schoolId },
      )
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
      campaigns: {
        available: false,
        items: [],
        message:
          'El seguimiento administrativo de campañas por colegio se incorporará en el módulo de presentaciones.',
      },
      evaluations: {
        available: false,
        items: [],
        message: 'El módulo de evaluaciones aún no está implementado.',
      },
      actions: {
        canEdit: true,
        canChangeStatus: true,
        canReplaceUser: true,
        canStartEvaluation: school.isActive,
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
    return {
      school: association.school,
      rectification: {
        id: rectification?.id ?? null,
        periodYear,
        isRectified: Boolean(rectification),
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
    const periodYear = this.currentPeriodYear();
    try {
      await this.dataSource.transaction(async (manager) => {
        const school = await manager.getRepository(School).findOne({
          where: { id: schoolId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!school) throw new NotFoundException('Colegio no encontrado.');
        this.assertExpectedUpdate(school, dto.expectedUpdatedAt);
        const currentStructured = await this.structuredState(manager, school);
        const normalized = {
          name: dto.name,
          cue: dto.cue.toUpperCase(),
          directorName: dto.directorName,
          address: dto.address,
          locality: dto.locality,
          scope: dto.scope,
          ...(dto.educationLevel !== undefined
            ? { educationLevel: dto.educationLevel }
            : {}),
          ...(dto.shift !== undefined ? { shift: dto.shift } : {}),
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
        const before = this.rectificationSnapshot(
          school,
          currentStructured.shiftCatalog,
          currentStructured.educationLevels,
          currentStructured.contacts,
        );
        Object.assign(school, normalized);
        if (dto.hasKiosk !== undefined) school.hasKiosk = dto.hasKiosk;
        if (dto.hasFoodService !== undefined)
          school.hasFoodService = dto.hasFoodService;
        if (dto.isBoarding !== undefined) school.isBoarding = dto.isBoarding;
        if (dto.shiftCatalogId !== undefined)
          school.shiftCatalogId = selectedShift?.id ?? null;
        if (dto.enrollment !== undefined) school.enrollment = dto.enrollment;
        await manager.save(School, school);

        const finalContacts =
          dto.contacts === undefined
            ? currentStructured.contacts
            : await this.replaceContacts(manager, school, dto.contacts);

        if (dto.educationLevels !== undefined) {
          await manager.delete(SchoolEducationLevel, { schoolId });
          if (selectedLevels.length)
            await manager.save(
              SchoolEducationLevel,
              selectedLevels.map((selected, order) =>
                manager.create(SchoolEducationLevel, {
                  schoolId,
                  levelId: selected.level.id,
                  enrollment: selected.enrollment,
                  order,
                }),
              ),
            );
        }

        const rectificationId = randomUUID();
        const capturedAt = new Date();
        const finalShift =
          dto.shiftCatalogId === undefined
            ? currentStructured.shiftCatalog
            : selectedShift;
        const finalLevels =
          dto.educationLevels === undefined
            ? currentStructured.educationLevels
            : selectedLevels;
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
    const normalized = this.normalize(dto);
    const requestedContacts = normalized.contacts;
    delete (normalized as Partial<CreateSchoolDto>).contacts;
    this.validateCharacteristics(normalized.characteristics);
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        await this.assertCueUnique(manager, normalized.cue);
        const school = await manager.save(
          School,
          manager.create(School, normalized),
        );
        await this.replaceContacts(
          manager,
          school,
          requestedContacts ?? [this.legacyRespondentContact(school)],
        );
        await this.audit(
          manager,
          actor.id,
          'SCHOOL_CREATED',
          school.id,
          this.snapshot(school),
        );
        return school.id;
      });
      return this.findOne(id);
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
        const before = this.snapshot(school);
        const normalized = this.normalize(dto);
        const requestedContacts = normalized.contacts;
        delete (normalized as Partial<UpdateSchoolDto>).contacts;
        if (normalized.cue && normalized.cue !== school.cue)
          await this.assertCueUnique(manager, normalized.cue, id);
        if (normalized.characteristics)
          this.validateCharacteristics(normalized.characteristics);
        Object.assign(school, normalized);
        await manager.save(School, school);
        if (requestedContacts)
          await this.replaceContacts(manager, school, requestedContacts);
        const changes = this.diff(before, this.snapshot(school));
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
      if (school.isActive === isActive) return;
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
        },
      );
    });
    return this.findOne(id);
  }

  /** Valida en backend que un colegio pueda iniciar una nueva evaluación. */
  async assertActiveForEvaluation(
    schoolId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const school = await manager.findOneBy(School, { id: schoolId });
    if (!school) throw new NotFoundException('Colegio no encontrado.');
    if (!school.isActive)
      throw new ConflictException(
        'El colegio está inactivo y no puede iniciar nuevas evaluaciones.',
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
        next = await manager.findOneBy(User, { id: dto.userId });
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
        if (otherAssignment && otherAssignment.schoolId !== id)
          throw new ConflictException(
            'El usuario ya está asociado a otro colegio.',
          );
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
      'Referente respondente',
      'Cargo respondente',
      'Correo respondente',
      'Teléfono respondente',
      'Referente de promoción de la salud',
      'Cargo promoción de la salud',
      'Correo promoción de la salud',
      'Teléfono promoción de la salud',
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
      const healthPromotion = schoolContacts.find(
        ({ type }) => type === SchoolContactType.HealthPromotion,
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
        healthPromotion
          ? `${healthPromotion.lastName}, ${healthPromotion.firstName}`
          : '',
        healthPromotion?.position ?? '',
        healthPromotion?.email ?? '',
        healthPromotion?.phone ?? '',
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
      characteristics: school.characteristics,
      isActive: school.isActive,
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
            schemaVersion: 3,
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
      enrollmentTotal: school.enrollment ?? null,
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
        'Debe informarse el referente respondente del establecimiento.',
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

  private rectificationStatus(rectifications: SchoolRectification[]) {
    const periodYear = this.currentPeriodYear();
    const latest = rectifications.find(
      (rectification) => rectification.periodYear === periodYear,
    );
    return {
      periodYear,
      isRectified: Boolean(latest),
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
    const db = error as { code?: string; driverError?: { code?: string } };
    if (db?.code === '23505' || db?.driverError?.code === '23505')
      throw new ConflictException('Ya existe un colegio con ese CUE.');
    throw error;
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

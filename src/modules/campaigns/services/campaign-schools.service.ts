import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  ObjectLiteral,
  SelectQueryBuilder,
} from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import {
  CampaignSchoolFiltersDto,
  CampaignSchoolSelectionDto,
  ListCampaignSchoolsQueryDto,
} from '../dto/campaign-school-selection.dto';
import { CampaignStatus } from '../entities/campaign-status.enum';
import {
  CampaignSchool,
  CampaignSchoolAssignmentSource,
} from '../entities/campaign-school.entity';
import { Campaign } from '../entities/campaign.entity';

// TypeORM debe propagar este valor por su subconsulta DISTINCT al paginar joins.
const SCHOOL_NAME_SORT_ALIAS = 'school_name_sort';

@Injectable()
export class CampaignSchoolsService {
  private readonly logger = new Logger(CampaignSchoolsService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(campaignId: string, query: ListCampaignSchoolsQueryDto) {
    await this.getCampaign(campaignId);
    const builder = this.assignedBuilder(campaignId, query)
      .select([
        'assignment.id',
        'assignment.assignedAt',
        'assignment.assignmentSource',
        'school.id',
        'school.cue',
        'school.name',
        'school.department',
        'school.locality',
        'school.educationLevel',
        'school.managementType',
        'school.scope',
        'school.shift',
        'school.isActive',
      ])
      .addSelect('LOWER(school.name)', SCHOOL_NAME_SORT_ALIAS)
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [items, total] = await builder.getManyAndCount();
    return {
      items: items.map((assignment) => this.serialize(assignment)),
      pagination: this.pagination(query, total),
    };
  }

  async options(campaignId: string, query: ListCampaignSchoolsQueryDto) {
    await this.getCampaign(campaignId);
    const builder = this.filteredSchools(query)
      .leftJoin(
        CampaignSchool,
        'assignment',
        'assignment.schoolId = school.id AND assignment.campaignId = :campaignId AND assignment.removedAt IS NULL',
        { campaignId },
      )
      .select('school.id', 'id')
      .addSelect('school.cue', 'cue')
      .addSelect('school.name', 'name')
      .addSelect('school.department', 'department')
      .addSelect('school.locality', 'locality')
      .addSelect('school.isActive', 'isActive')
      .addSelect(
        'CASE WHEN assignment.id IS NULL THEN false ELSE true END',
        'assigned',
      )
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    const assignedCountBuilder = this.filteredSchools(query).innerJoin(
      CampaignSchool,
      'current_assignment',
      'current_assignment.schoolId = school.id AND current_assignment.campaignId = :campaignId AND current_assignment.removedAt IS NULL',
      { campaignId },
    );
    const [items, total, assigned] = await Promise.all([
      builder.getRawMany<Record<string, unknown>>(),
      this.filteredSchools(query).getCount(),
      assignedCountBuilder.getCount(),
    ]);
    return {
      items,
      pagination: this.pagination(query, total),
      summary: { matched: total, assigned, unassigned: total - assigned },
    };
  }

  async preview(campaignId: string, dto: CampaignSchoolSelectionDto) {
    const campaign = await this.getCampaignForAssignment(campaignId);
    const schoolIds = await this.resolveSchoolIds(dto);
    const existingAssignments = schoolIds.length
      ? await this.dataSource.getRepository(CampaignSchool).find({
          select: { schoolId: true },
          where: { campaignId, schoolId: In(schoolIds), removedAt: IsNull() },
        })
      : [];
    const existingSchoolIds = new Set(
      existingAssignments.map(({ schoolId }) => schoolId),
    );
    await this.assertSchoolsEligibleForAssignment(
      campaign,
      schoolIds.filter((schoolId) => !existingSchoolIds.has(schoolId)),
    );
    const willAssign = schoolIds.length - existingAssignments.length;
    return {
      matched: schoolIds.length,
      alreadyAssigned: existingAssignments.length,
      willAssign,
      message:
        willAssign === 1
          ? 'Se asignará 1 escuela.'
          : `Se asignarán ${willAssign} escuelas.`,
    };
  }

  async assign(
    campaignId: string,
    dto: CampaignSchoolSelectionDto,
    actor: AuthenticatedUser,
  ) {
    let outcome: { matched: number; assigned: number };
    try {
      outcome = await this.dataSource.transaction(async (manager) => {
        const campaign = await this.getCampaignForAssignment(
          campaignId,
          manager,
        );
        const schoolIds = await this.resolveSchoolIds(dto, manager);
        if (!schoolIds.length)
          throw new BadRequestException(
            'La selección no contiene escuelas para asignar.',
          );
        const existing = await manager.find(CampaignSchool, {
          where: { campaignId, schoolId: In(schoolIds) },
        });
        const bySchool = new Map(
          existing.map((value) => [value.schoolId, value]),
        );
        await this.assertSchoolsEligibleForAssignment(
          campaign,
          schoolIds.filter((schoolId) => {
            const current = bySchool.get(schoolId);
            return !current || Boolean(current.removedAt);
          }),
          manager,
          true,
        );
        const now = new Date();
        const reactivatedSchoolIds: string[] = [];
        const assignments = schoolIds
          .map((schoolId) => {
            const current = bySchool.get(schoolId);
            if (current && !current.removedAt) return null;
            if (current?.removedAt) reactivatedSchoolIds.push(schoolId);
            return manager.create(CampaignSchool, {
              ...(current ?? {}),
              campaignId,
              schoolId,
              assignedByUserId: actor.id,
              assignedAt: now,
              assignmentSource: dto.source,
              removedAt: null,
              removalReason: null,
            });
          })
          .filter((value): value is CampaignSchool => Boolean(value));
        if (assignments.length) await manager.save(CampaignSchool, assignments);
        await this.audit(
          manager,
          actor.id,
          'CAMPAIGN_SCHOOLS_ASSIGNED',
          campaignId,
          {
            assignedAt: now,
            campaignStatus: campaign.status,
            source: dto.source,
            matchedCount: schoolIds.length,
            assignedCount: assignments.length,
            alreadyAssignedCount: schoolIds.length - assignments.length,
            assignedSchoolIds: assignments.map(
              (assignment) => assignment.schoolId,
            ),
            reactivatedSchoolIds,
          },
        );
        return { matched: schoolIds.length, assigned: assignments.length };
      });
    } catch (error) {
      if (!this.isSchemaMismatch(error)) throw error;
      const databaseError = error as {
        code?: string;
        constraint?: string;
        table?: string;
      };
      this.logger.error({
        event: 'CAMPAIGN_SCHOOLS_SCHEMA_MISMATCH',
        campaignId,
        databaseCode: databaseError.code ?? null,
        constraint: databaseError.constraint ?? null,
        table: databaseError.table ?? null,
      });
      throw new ServiceUnavailableException({
        code: 'CAMPAIGN_SCHOOLS_SCHEMA_UNAVAILABLE',
        message:
          'La asignación de escuelas no está disponible porque el esquema de datos de etapas requiere actualización.',
      });
    }
    return { ...outcome, summary: await this.assignmentSummary(campaignId) };
  }

  async remove(
    campaignId: string,
    schoolId: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      await this.getDraftCampaign(campaignId, manager);
      const assignment = await manager.findOne(CampaignSchool, {
        where: { campaignId, schoolId, removedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!assignment)
        throw new NotFoundException('La escuela no está asignada a la etapa.');
      if (
        await manager.exists(SurveySubmission, {
          where: { campaignId, schoolId },
        })
      )
        throw new ConflictException(
          'No se puede quitar una escuela que ya posee una presentación.',
        );
      assignment.removedAt = new Date();
      assignment.removalReason = reason?.trim() || null;
      await manager.save(CampaignSchool, assignment);
      await this.audit(
        manager,
        actor.id,
        'CAMPAIGN_SCHOOL_REMOVED',
        assignment.id,
        {
          campaignId,
          schoolId,
          reason: assignment.removalReason,
        },
      );
    });
    return this.assignmentSummary(campaignId);
  }

  async assignmentSummary(campaignId: string) {
    const row = await this.dataSource
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .select(
        'COUNT(*) FILTER (WHERE assignment.removedAt IS NULL)',
        'assigned',
      )
      .addSelect(
        'COUNT(*) FILTER (WHERE assignment.removedAt IS NOT NULL)',
        'removed',
      )
      .where('assignment.campaignId = :campaignId', { campaignId })
      .getRawOne<{ assigned: string; removed: string }>();
    return {
      assigned: Number(row?.assigned ?? 0),
      removed: Number(row?.removed ?? 0),
    };
  }

  async assertAssigned(
    campaignId: string,
    schoolId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const assigned = await manager.exists(CampaignSchool, {
      where: { campaignId, schoolId, removedAt: IsNull() },
    });
    if (!assigned)
      throw new ConflictException(
        'El establecimiento no está asignado a esta etapa.',
      );
  }

  private async resolveSchoolIds(
    dto: CampaignSchoolSelectionDto,
    manager: EntityManager = this.dataSource.manager,
  ) {
    if (dto.source === CampaignSchoolAssignmentSource.Manual) {
      if (!dto.schoolIds?.length)
        throw new BadRequestException(
          'La selección manual requiere al menos una escuela.',
        );
      const rows = await manager.getRepository(School).find({
        select: { id: true },
        where: { id: In(dto.schoolIds) },
      });
      if (rows.length !== dto.schoolIds.length)
        throw new BadRequestException(
          'La selección contiene escuelas inexistentes.',
        );
      return rows.map(({ id }) => id);
    }
    return (
      await this.filteredSchools(dto, manager)
        .select('school.id', 'id')
        .getRawMany<{ id: string }>()
    ).map(({ id }) => id);
  }

  private assignedBuilder(campaignId: string, query: CampaignSchoolFiltersDto) {
    const builder = this.dataSource
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .innerJoinAndSelect('assignment.school', 'school')
      .where('assignment.campaignId = :campaignId', { campaignId })
      .andWhere('assignment.removedAt IS NULL')
      .orderBy(SCHOOL_NAME_SORT_ALIAS, 'ASC')
      .addOrderBy('school.cue', 'ASC')
      .addOrderBy('school.id', 'ASC');
    this.applySchoolFilters(builder, query);
    return builder;
  }

  private filteredSchools(
    filters: CampaignSchoolFiltersDto,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const builder = manager
      .getRepository(School)
      .createQueryBuilder('school')
      .orderBy('LOWER(school.name)', 'ASC')
      .addOrderBy('school.cue', 'ASC')
      .addOrderBy('school.id', 'ASC');
    this.applySchoolFilters(builder, filters);
    return builder;
  }

  private applySchoolFilters<T extends ObjectLiteral>(
    builder: SelectQueryBuilder<T>,
    filters: CampaignSchoolFiltersDto,
  ) {
    if (filters.search)
      builder.andWhere(
        '(LOWER(school.name) LIKE :search OR LOWER(school.cue) LIKE :search)',
        { search: `%${filters.search.toLowerCase()}%` },
      );
    for (const [property, column] of [
      ['department', 'department'],
      ['locality', 'locality'],
      ['educationLevel', 'education_level'],
      ['managementType', 'management_type'],
      ['scope', 'scope'],
      ['shift', 'shift'],
    ] as const) {
      if (filters[property])
        builder.andWhere(`school.${column} = :${property}`, {
          [property]: filters[property],
        });
    }
    if (filters.isActive !== undefined)
      builder.andWhere('school.is_active = :isActive', {
        isActive: filters.isActive,
      });
  }

  private async getCampaign(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const campaign = await manager.findOneBy(Campaign, { id });
    if (!campaign) throw new NotFoundException('La etapa no existe.');
    return campaign;
  }

  private async getDraftCampaign(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const campaign = await manager.findOne(Campaign, {
      where: { id },
      lock: manager.queryRunner ? { mode: 'pessimistic_write' } : undefined,
    });
    if (!campaign) throw new NotFoundException('La etapa no existe.');
    if (campaign.status !== CampaignStatus.Draft)
      throw new ConflictException(
        'Las escuelas sólo pueden quitarse mientras la etapa está en borrador.',
      );
    return campaign;
  }

  /**
   * Valida el estado que admite una incorporación de escuelas.
   *
   * La respuesta funcional vigente permite incorporar escuelas durante una
   * etapa activa. Dentro de la operación definitiva, el bloqueo de la fila
   * evita que un alta pueda confirmarse detrás de un cierre concurrente. La
   * vista previa ejecuta la misma validación sin bloquear. Las etapas activas
   * que ya vencieron se tratan como cerradas aunque el proceso periódico aún no
   * haya persistido el cambio de estado.
   */
  private async getCampaignForAssignment(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const campaign = await manager.findOne(Campaign, {
      where: { id },
      lock: manager.queryRunner ? { mode: 'pessimistic_write' } : undefined,
    });
    if (!campaign) throw new NotFoundException('La etapa no existe.');
    if (
      campaign.status !== CampaignStatus.Draft &&
      campaign.status !== CampaignStatus.Active
    )
      throw new ConflictException(
        'Las escuelas sólo pueden incorporarse mientras la etapa está en borrador o activa.',
      );
    if (
      campaign.status === CampaignStatus.Active &&
      campaign.endsAt.getTime() <= Date.now()
    )
      throw new ConflictException(
        'No se pueden incorporar escuelas porque la etapa ya finalizó.',
      );
    return campaign;
  }

  /**
   * Durante una etapa activa sólo una escuela habilitada puede incorporarse.
   *
   * Las asignaciones ya vigentes quedan fuera de esta validación para que una
   * repetición sea idempotente aun cuando la escuela haya sido dada de baja
   * después. La operación definitiva bloquea las escuelas en orden estable y
   * se serializa así con `SchoolsService.setStatus`.
   */
  private async assertSchoolsEligibleForAssignment(
    campaign: Campaign,
    schoolIds: string[],
    manager: EntityManager = this.dataSource.manager,
    lockRows = false,
  ) {
    if (campaign.status !== CampaignStatus.Active || !schoolIds.length) return;
    const schools = await manager.getRepository(School).find({
      select: { id: true, isActive: true },
      where: { id: In(schoolIds) },
      order: { id: 'ASC' },
      lock:
        lockRows && manager.queryRunner
          ? { mode: 'pessimistic_read' }
          : undefined,
    });
    if (schools.length !== schoolIds.length)
      throw new ConflictException(
        'Una o más escuelas dejaron de estar disponibles para la asignación.',
      );
    if (schools.some(({ isActive }) => !isActive))
      throw new ConflictException(
        'No se pueden incorporar escuelas inactivas a una etapa activa.',
      );
  }

  private serialize(assignment: CampaignSchool) {
    return {
      id: assignment.id,
      assignedAt: assignment.assignedAt,
      assignmentSource: assignment.assignmentSource,
      school: assignment.school,
    };
  }

  private pagination(query: ListCampaignSchoolsQueryDto, total: number) {
    return {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  private async audit(
    manager: EntityManager,
    actorUserId: string,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    await manager.save(AuditLog, {
      actorUserId,
      action,
      entityType: 'CampaignSchool',
      entityId,
      changes,
    });
  }

  private isSchemaMismatch(error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    return ['42P01', '42703', '42704'].includes(String(error.code));
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThanOrEqual, MoreThan } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SurveyVersionStatus } from '../../surveys/entities/survey-version-status.enum';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { ListCampaignsQueryDto } from '../dto/list-campaigns-query.dto';
import { UpdateCampaignDto } from '../dto/update-campaign.dto';
import { CampaignStatus } from '../entities/campaign-status.enum';
import { Campaign } from '../entities/campaign.entity';
import {
  mendozaDateString,
  mendozaDayEnd,
  mendozaDayStart,
} from './mendoza-date.util';

const STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CampaignStatus.Draft]: [CampaignStatus.Active],
  [CampaignStatus.Active]: [CampaignStatus.Closed],
  [CampaignStatus.Closed]: [CampaignStatus.Archived],
  [CampaignStatus.Archived]: [],
};

@Injectable()
export class CampaignsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(query: ListCampaignsQueryDto) {
    await this.closeExpiredCampaigns();
    const builder = this.dataSource
      .getRepository(Campaign)
      .createQueryBuilder('campaign')
      .innerJoinAndSelect('campaign.surveyVersion', 'version')
      .innerJoinAndSelect('version.survey', 'survey')
      .orderBy('campaign.startsAt', 'DESC')
      .addOrderBy('campaign.name', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.search)
      builder.andWhere(
        '(LOWER(campaign.name) LIKE :search OR LOWER(survey.name) LIKE :search)',
        { search: `%${query.search.trim().toLowerCase()}%` },
      );
    if (query.status)
      builder.andWhere('campaign.status = :status', { status: query.status });
    if (query.type)
      builder.andWhere('campaign.type = :type', { type: query.type });

    const [campaigns, total] = await builder.getManyAndCount();
    return {
      items: campaigns.map((campaign) => this.serialize(campaign)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async findOne(id: string) {
    await this.closeExpiredCampaigns();
    return this.serialize(await this.getCampaign(id));
  }

  /** Lista únicamente versiones publicadas de cuestionarios activos. */
  async publishedVersionOptions() {
    const versions = await this.dataSource
      .getRepository(SurveyVersion)
      .createQueryBuilder('version')
      .innerJoinAndSelect('version.survey', 'survey')
      .where('version.status = :status', {
        status: SurveyVersionStatus.Published,
      })
      .andWhere('survey.isActive = true')
      .orderBy('survey.name', 'ASC')
      .addOrderBy('version.versionNumber', 'DESC')
      .getMany();

    return versions.map((version) => ({
      id: version.id,
      surveyId: version.surveyId,
      surveyCode: version.survey.code,
      surveyName: version.survey.name,
      versionNumber: version.versionNumber,
      versionTitle: version.title,
      publishedAt: version.publishedAt,
    }));
  }

  /** Devuelve campañas activas cuyo período está abierto en este instante. */
  async operationalCampaigns() {
    await this.closeExpiredCampaigns();
    const now = new Date();
    return this.dataSource.getRepository(Campaign).find({
      where: {
        status: CampaignStatus.Active,
        startsAt: LessThanOrEqual(now),
        endsAt: MoreThan(now),
      },
      relations: { surveyVersion: { survey: true } },
      order: { startsAt: 'ASC', name: 'ASC' },
    });
  }

  /**
   * Valida el estado y las fechas en backend para impedir cargas fuera del
   * período aunque el cierre periódico aún no haya persistido el estado.
   */
  async assertOperational(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const campaign = await manager.findOne(Campaign, {
      where: { id },
      relations: { surveyVersion: { survey: true } },
    });
    if (!campaign) throw new NotFoundException('Campaña no encontrada.');
    const now = Date.now();
    if (
      campaign.status !== CampaignStatus.Active ||
      now < campaign.startsAt.getTime() ||
      now > campaign.endsAt.getTime()
    )
      throw new ConflictException(
        'La campaña no se encuentra abierta para recibir respuestas.',
      );
    return campaign;
  }

  async create(dto: CreateCampaignDto, actor: AuthenticatedUser) {
    const dates = this.resolveDates(dto.startDate, dto.endDate);
    const id = await this.dataSource.transaction(async (manager) => {
      const version = await this.assertPublishedVersion(
        manager,
        dto.surveyVersionId,
      );
      const campaign = await manager.save(
        Campaign,
        manager.create(Campaign, {
          name: dto.name.trim(),
          description: this.nullable(dto.description),
          type: dto.type,
          status: CampaignStatus.Draft,
          surveyVersionId: version.id,
          ...dates,
          activatedAt: null,
          closedAt: null,
          archivedAt: null,
        }),
      );
      await this.audit(
        manager,
        actor.id,
        'CAMPAIGN_CREATED',
        campaign.id,
        this.snapshot(campaign),
      );
      return campaign.id;
    });
    return this.findOne(id);
  }

  async update(id: string, dto: UpdateCampaignDto, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const campaign = await this.getLockedCampaign(manager, id);
      this.assertDraft(campaign);
      const before = this.snapshot(campaign);

      if (dto.name !== undefined) campaign.name = dto.name.trim();
      if (dto.description !== undefined)
        campaign.description = this.nullable(dto.description);
      if (dto.type !== undefined) campaign.type = dto.type;
      if (dto.surveyVersionId !== undefined) {
        const version = await this.assertPublishedVersion(
          manager,
          dto.surveyVersionId,
        );
        campaign.surveyVersionId = version.id;
      }
      if (dto.startDate !== undefined || dto.endDate !== undefined) {
        const dates = this.resolveDates(
          dto.startDate ?? mendozaDateString(campaign.startsAt),
          dto.endDate ?? mendozaDateString(campaign.endsAt),
        );
        campaign.startsAt = dates.startsAt;
        campaign.endsAt = dates.endsAt;
      }

      await manager.save(Campaign, campaign);
      await this.audit(manager, actor.id, 'CAMPAIGN_UPDATED', campaign.id, {
        before,
        after: this.snapshot(campaign),
      });
    });
    return this.findOne(id);
  }

  async setStatus(
    id: string,
    nextStatus: CampaignStatus,
    actor: AuthenticatedUser,
  ) {
    await this.closeExpiredCampaigns();
    await this.dataSource.transaction(async (manager) => {
      const campaign = await this.getLockedCampaign(manager, id);
      if (campaign.status === nextStatus) return;
      if (!STATUS_TRANSITIONS[campaign.status].includes(nextStatus))
        throw new ConflictException(
          `No se puede pasar una campaña de ${campaign.status} a ${nextStatus}.`,
        );

      if (nextStatus === CampaignStatus.Active) {
        await this.assertPublishedVersion(manager, campaign.surveyVersionId);
        if (campaign.endsAt.getTime() <= Date.now())
          throw new ConflictException(
            'No se puede activar una campaña cuya fecha de cierre ya venció.',
          );
        campaign.activatedAt = new Date();
      }
      if (nextStatus === CampaignStatus.Closed) campaign.closedAt = new Date();
      if (nextStatus === CampaignStatus.Archived)
        campaign.archivedAt = new Date();

      const previousStatus = campaign.status;
      campaign.status = nextStatus;
      await manager.save(Campaign, campaign);
      await this.audit(
        manager,
        actor.id,
        'CAMPAIGN_STATUS_CHANGED',
        campaign.id,
        { from: previousStatus, to: nextStatus },
      );
    });
    return this.findOne(id);
  }

  async delete(id: string, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const campaign = await this.getLockedCampaign(manager, id);
      this.assertDraft(campaign);
      await this.audit(
        manager,
        actor.id,
        'CAMPAIGN_DELETED',
        campaign.id,
        this.snapshot(campaign),
      );
      await manager.delete(Campaign, campaign.id);
    });
  }

  /**
   * Persiste el cierre cuando vence el instante 23:59:59.999 ART.
   *
   * Las validaciones de acceso futuras deberán comparar también `endsAt`
   * para que el bloqueo sea exacto aunque el proceso periódico todavía no
   * haya actualizado el estado persistido.
   */
  @Interval(30_000)
  async closeExpiredCampaigns() {
    const now = new Date();
    const expired = await this.dataSource.getRepository(Campaign).find({
      where: {
        status: CampaignStatus.Active,
        endsAt: LessThanOrEqual(now),
      },
    });

    for (const campaign of expired) {
      await this.dataSource.transaction(async (manager) => {
        const update = await manager
          .createQueryBuilder()
          .update(Campaign)
          .set({
            status: CampaignStatus.Closed,
            closedAt: campaign.endsAt,
          })
          .where('id = :id AND status = :status', {
            id: campaign.id,
            status: CampaignStatus.Active,
          })
          .execute();
        if (!update.affected) return;
        await this.audit(
          manager,
          null,
          'CAMPAIGN_CLOSED_AUTOMATICALLY',
          campaign.id,
          {
            closedAt: campaign.endsAt,
            detectedAt: now,
            timeZone: 'America/Argentina/Mendoza',
          },
        );
      });
    }
  }

  private resolveDates(startDate: string, endDate: string) {
    const startsAt = mendozaDayStart(startDate);
    const endsAt = mendozaDayEnd(endDate);
    if (endsAt.getTime() <= startsAt.getTime())
      throw new BadRequestException(
        'La fecha de cierre debe ser igual o posterior a la fecha de inicio.',
      );
    return { startsAt, endsAt };
  }

  private async assertPublishedVersion(
    manager: EntityManager,
    versionId: string,
  ) {
    const version = await manager.findOne(SurveyVersion, {
      where: { id: versionId },
      relations: { survey: true },
    });
    if (!version)
      throw new BadRequestException(
        'La versión de cuestionario seleccionada no existe.',
      );
    if (
      version.status !== SurveyVersionStatus.Published ||
      !version.publishedAt
    )
      throw new ConflictException(
        'La campaña sólo puede asociarse a una versión publicada.',
      );
    if (!version.survey.isActive)
      throw new ConflictException(
        'El cuestionario asociado se encuentra inactivo.',
      );
    return version;
  }

  private async getCampaign(id: string) {
    const campaign = await this.dataSource.getRepository(Campaign).findOne({
      where: { id },
      relations: { surveyVersion: { survey: true } },
    });
    if (!campaign) throw new NotFoundException('Campaña no encontrada.');
    return campaign;
  }

  private async getLockedCampaign(manager: EntityManager, id: string) {
    const campaign = await manager.findOne(Campaign, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!campaign) throw new NotFoundException('Campaña no encontrada.');
    return campaign;
  }

  private assertDraft(campaign: Campaign) {
    if (campaign.status !== CampaignStatus.Draft)
      throw new ConflictException(
        'Sólo las campañas en borrador pueden editarse o eliminarse.',
      );
  }

  private serialize(campaign: Campaign) {
    return {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      type: campaign.type,
      status: campaign.status,
      startDate: mendozaDateString(campaign.startsAt),
      endDate: mendozaDateString(campaign.endsAt),
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      activatedAt: campaign.activatedAt,
      closedAt: campaign.closedAt,
      archivedAt: campaign.archivedAt,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
      surveyVersion: {
        id: campaign.surveyVersion.id,
        versionNumber: campaign.surveyVersion.versionNumber,
        title: campaign.surveyVersion.title,
        publishedAt: campaign.surveyVersion.publishedAt,
        survey: {
          id: campaign.surveyVersion.survey.id,
          code: campaign.surveyVersion.survey.code,
          name: campaign.surveyVersion.survey.name,
        },
      },
    };
  }

  private snapshot(campaign: Campaign) {
    return {
      name: campaign.name,
      description: campaign.description,
      type: campaign.type,
      status: campaign.status,
      surveyVersionId: campaign.surveyVersionId,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
    };
  }

  private nullable(value: string | null | undefined) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private audit(
    manager: EntityManager,
    actorUserId: string | null,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    return manager.save(AuditLog, {
      actorUserId,
      action,
      entityType: 'Campaign',
      entityId,
      changes,
    });
  }
}

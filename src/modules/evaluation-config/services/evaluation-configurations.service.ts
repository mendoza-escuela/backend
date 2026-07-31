import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import {
  CloneEvaluationConfigurationDto,
  CreateEvaluationConfigurationDto,
  UpdateEvaluationConfigurationDto,
} from '../dto/evaluation-configuration.dto';
import { EvaluationConfigurationStatus } from '../entities/evaluation-configuration-status.enum';
import { EvaluationConfiguration } from '../entities/evaluation-configuration.entity';
import { EvaluationStarRange } from '../entities/evaluation-star-range.entity';
import { EvaluationConfigurationValidator } from './evaluation-configuration-validator.service';

@Injectable()
export class EvaluationConfigurationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly validator: EvaluationConfigurationValidator,
  ) {}

  list() {
    return this.dataSource.getRepository(EvaluationConfiguration).find({
      relations: {
        starRanges: true,
        createdBy: true,
        activatedBy: true,
        archivedBy: true,
      },
      order: { createdAt: 'DESC', starRanges: { order: 'ASC' } },
    });
  }

  async get(id: string, manager: EntityManager = this.dataSource.manager) {
    const configuration = await manager.findOne(EvaluationConfiguration, {
      where: { id },
      relations: {
        starRanges: true,
        createdBy: true,
        activatedBy: true,
        archivedBy: true,
      },
      order: { starRanges: { order: 'ASC' } },
    });
    if (!configuration)
      throw new NotFoundException('Configuración de evaluación no encontrada.');
    return configuration;
  }

  async active(manager: EntityManager) {
    const configuration = await manager.findOne(EvaluationConfiguration, {
      where: { status: EvaluationConfigurationStatus.Active },
      relations: { starRanges: true },
      order: { starRanges: { order: 'ASC' } },
      lock: { mode: 'pessimistic_read' },
    });
    if (!configuration)
      throw new ConflictException({
        code: 'ACTIVE_EVALUATION_CONFIGURATION_REQUIRED',
        message:
          'No existe una configuración de evaluación activa. El envío no fue realizado.',
      });
    this.validator.validate(this.rangeInputs(configuration));
    return configuration;
  }

  create(dto: CreateEvaluationConfigurationDto, actorUserId: string) {
    return this.dataSource.transaction(async (manager) => {
      this.validator.validate(dto.starRanges);
      const configuration = manager.create(EvaluationConfiguration, {
        ...this.values(dto),
        status: EvaluationConfigurationStatus.Draft,
        createdByUserId: actorUserId,
        activatedAt: null,
        activatedByUserId: null,
        archivedAt: null,
        archivedByUserId: null,
      });
      const saved = await manager.save(configuration);
      saved.starRanges = await manager.save(
        EvaluationStarRange,
        dto.starRanges.map((range) =>
          manager.create(EvaluationStarRange, {
            ...range,
            lowerBound: String(range.lowerBound),
            upperBound: String(range.upperBound),
            configurationId: saved.id,
          }),
        ),
      );
      await this.audit(
        manager,
        actorUserId,
        'EVALUATION_CONFIGURATION_CREATED',
        saved.id,
        null,
        this.summary(saved),
      );
      return saved;
    });
  }

  update(
    id: string,
    dto: UpdateEvaluationConfigurationDto,
    actorUserId: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      this.validator.validate(dto.starRanges);
      const configuration = await this.get(id, manager);
      this.assertDraft(configuration);
      const before = this.summary(configuration);
      Object.assign(configuration, this.values(dto));
      await manager.save(configuration);
      await manager.delete(EvaluationStarRange, { configurationId: id });
      configuration.starRanges = await manager.save(
        EvaluationStarRange,
        dto.starRanges.map((range) =>
          manager.create(EvaluationStarRange, {
            ...range,
            lowerBound: String(range.lowerBound),
            upperBound: String(range.upperBound),
            configurationId: id,
          }),
        ),
      );
      await this.audit(
        manager,
        actorUserId,
        'EVALUATION_CONFIGURATION_UPDATED',
        id,
        before,
        this.summary(configuration),
      );
      return configuration;
    });
  }

  async clone(
    id: string,
    dto: CloneEvaluationConfigurationDto,
    actorUserId: string,
  ) {
    const source = await this.get(id);
    return this.create(
      {
        versionCode: dto.versionCode,
        name: dto.name ?? `${source.name} (copia)`,
        description: source.description ?? undefined,
        mentalHealthCriticalThreshold: Number(
          source.mentalHealthCriticalThreshold,
        ),
        mentalHealthMaxStars: source.mentalHealthMaxStars,
        metadata: structuredClone(source.metadata),
        starRanges: this.rangeInputs(source),
      },
      actorUserId,
    );
  }

  async validate(id: string) {
    const configuration = await this.get(id);
    this.validator.validate(this.rangeInputs(configuration));
    return { valid: true, errors: [] as string[] };
  }

  activate(id: string, actorUserId: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('evaluation_configuration_activation'))`,
      );
      const target = await this.get(id, manager);
      this.assertDraft(target);
      this.validator.validate(this.rangeInputs(target));
      const now = new Date();
      const current = await manager.findOne(EvaluationConfiguration, {
        where: { status: EvaluationConfigurationStatus.Active },
        lock: { mode: 'pessimistic_write' },
      });
      if (current) {
        current.status = EvaluationConfigurationStatus.Archived;
        current.archivedAt = now;
        current.archivedByUserId = actorUserId;
        await manager.save(current);
        await this.audit(
          manager,
          actorUserId,
          'EVALUATION_CONFIGURATION_ARCHIVED',
          current.id,
          { status: EvaluationConfigurationStatus.Active },
          { status: EvaluationConfigurationStatus.Archived },
        );
      }
      target.status = EvaluationConfigurationStatus.Active;
      target.activatedAt = now;
      target.activatedByUserId = actorUserId;
      await manager.save(target);
      await this.audit(
        manager,
        actorUserId,
        'EVALUATION_CONFIGURATION_ACTIVATED',
        target.id,
        { status: EvaluationConfigurationStatus.Draft },
        this.summary(target),
      );
      return target;
    });
  }

  archive(id: string, actorUserId: string) {
    return this.dataSource.transaction(async (manager) => {
      const configuration = await this.get(id, manager);
      if (configuration.status !== EvaluationConfigurationStatus.Draft)
        throw new ConflictException(
          'Sólo puede archivarse manualmente una configuración en borrador.',
        );
      configuration.status = EvaluationConfigurationStatus.Archived;
      configuration.archivedAt = new Date();
      configuration.archivedByUserId = actorUserId;
      await manager.save(configuration);
      await this.audit(
        manager,
        actorUserId,
        'EVALUATION_CONFIGURATION_ARCHIVED',
        id,
        { status: EvaluationConfigurationStatus.Draft },
        { status: EvaluationConfigurationStatus.Archived },
      );
      return configuration;
    });
  }

  resolveStars(configuration: EvaluationConfiguration, score: number) {
    const range = [...configuration.starRanges]
      .sort((a, b) => a.order - b.order)
      .find(
        (candidate) =>
          (candidate.lowerInclusive
            ? score >= Number(candidate.lowerBound)
            : score > Number(candidate.lowerBound)) &&
          (candidate.upperInclusive
            ? score <= Number(candidate.upperBound)
            : score < Number(candidate.upperBound)),
      );
    if (!range)
      throw new ConflictException(
        'El puntaje general no está cubierto por la configuración activa.',
      );
    return range.stars;
  }

  evaluate(
    configuration: EvaluationConfiguration,
    generalScore: number,
    mentalHealthScore: number,
  ) {
    const baseStars = this.resolveStars(configuration, generalScore);
    const isMentalHealthCritical =
      mentalHealthScore < Number(configuration.mentalHealthCriticalThreshold);
    const causedBlocking = baseStars === 5 && isMentalHealthCritical;
    const finalStars = causedBlocking
      ? Math.min(baseStars, configuration.mentalHealthMaxStars)
      : baseStars;
    return { baseStars, finalStars, isMentalHealthCritical, causedBlocking };
  }

  snapshot(configuration: EvaluationConfiguration) {
    return {
      id: configuration.id,
      versionCode: configuration.versionCode,
      mentalHealthCriticalThreshold:
        configuration.mentalHealthCriticalThreshold,
      mentalHealthMaxStars: configuration.mentalHealthMaxStars,
      starRanges: [...configuration.starRanges]
        .sort((a, b) => a.order - b.order)
        .map(
          ({
            stars,
            lowerBound,
            upperBound,
            lowerInclusive,
            upperInclusive,
            order,
          }) => ({
            stars,
            lowerBound,
            upperBound,
            lowerInclusive,
            upperInclusive,
            order,
          }),
        ),
    };
  }

  private values(dto: CreateEvaluationConfigurationDto) {
    return {
      versionCode: dto.versionCode.trim(),
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      mentalHealthCriticalThreshold: String(dto.mentalHealthCriticalThreshold),
      mentalHealthMaxStars: dto.mentalHealthMaxStars,
      metadata: dto.metadata ?? {},
    };
  }
  private rangeInputs(configuration: EvaluationConfiguration) {
    return configuration.starRanges.map((range) => ({
      stars: range.stars,
      lowerBound: Number(range.lowerBound),
      upperBound: Number(range.upperBound),
      lowerInclusive: range.lowerInclusive,
      upperInclusive: range.upperInclusive,
      order: range.order,
    }));
  }
  private assertDraft(configuration: EvaluationConfiguration) {
    if (configuration.status !== EvaluationConfigurationStatus.Draft)
      throw new ConflictException(
        'Una configuración activa o archivada es inmutable; cree una nueva versión.',
      );
  }
  private summary(configuration: EvaluationConfiguration) {
    return {
      versionCode: configuration.versionCode,
      name: configuration.name,
      status: configuration.status,
      mentalHealthCriticalThreshold:
        configuration.mentalHealthCriticalThreshold,
      mentalHealthMaxStars: configuration.mentalHealthMaxStars,
    };
  }
  private audit(
    manager: EntityManager,
    actorUserId: string,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    return manager.save(
      AuditLog,
      manager.create(AuditLog, {
        actorUserId,
        action,
        entityType: 'EvaluationConfiguration',
        entityId,
        changes: { before, after },
      }),
    );
  }
}

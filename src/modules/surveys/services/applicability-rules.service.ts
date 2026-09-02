import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import {
  SchoolRectification,
  SchoolRectificationSnapshot,
} from '../../schools/entities/school-rectification.entity';
import { EducationLevelCatalog } from '../../schools/entities/education-level-catalog.entity';
import { SchoolShiftCatalog } from '../../schools/entities/school-shift-catalog.entity';
import {
  ApplicabilityRuleDefinitionDto,
  BulkCreateApplicabilityRuleDto,
  ReorderApplicabilityRulesDto,
  SurveyVersionRevisionDto,
  WriteApplicabilityRuleDto,
} from '../dto/applicability-rule.dto';
import { SurveyApplicabilityCondition } from '../entities/survey-applicability-condition.entity';
import {
  ApplicabilityAction,
  SurveyApplicabilityRule,
} from '../entities/survey-applicability-rule.entity';
import { SurveyQuestion } from '../entities/survey-question.entity';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { ApplicabilityEngine } from './applicability-engine.service';
import {
  APPLICABILITY_FEATURES,
  APPLICABILITY_OPERATORS,
  getFeatureDefinition,
} from './applicability-metadata';
import { schoolApplicabilityFactsFromSnapshot } from './school-applicability-facts';

@Injectable()
export class ApplicabilityRulesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly engine: ApplicabilityEngine,
  ) {}

  async metadata() {
    const [shifts, levels] = await Promise.all([
      this.dataSource.getRepository(SchoolShiftCatalog).find({
        order: { order: 'ASC', label: 'ASC' },
      }),
      this.dataSource.getRepository(EducationLevelCatalog).find({
        order: { order: 'ASC', label: 'ASC' },
      }),
    ]);
    return {
      features: APPLICABILITY_FEATURES.map((feature) => {
        const catalog =
          feature.key === 'shift'
            ? shifts
            : feature.key === 'education_levels'
              ? levels
              : null;
        return catalog
          ? {
              ...feature,
              allowedValues: catalog.map((entry) => ({
                value: entry.code,
                label: `${entry.label}${entry.isActive ? '' : ' (inactivo)'}`,
              })),
            }
          : feature;
      }),
      operators: APPLICABILITY_OPERATORS,
      resolution:
        'Las reglas se evalúan por orden ascendente y gana la primera coincidencia. Si ninguna coincide se aplica defaultAction. Los datos desconocidos producen estado incomplete.',
    };
  }

  async list(surveyId: string, versionId: string, questionId?: string) {
    return this.dataSource.transaction(async (manager) => {
      const version = await manager.findOne(SurveyVersion, {
        where: { id: versionId, surveyId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!version) throw new NotFoundException('Versión no encontrada.');
      const rules = await manager
        .getRepository(SurveyApplicabilityRule)
        .createQueryBuilder('rule')
        .innerJoinAndSelect('rule.question', 'question')
        .innerJoin('question.section', 'section')
        .innerJoin('section.dimension', 'dimension')
        .leftJoinAndSelect('rule.conditions', 'condition')
        .where('dimension.version_id = :versionId', { versionId })
        .andWhere(questionId ? 'question.id = :questionId' : 'TRUE', {
          questionId,
        })
        .orderBy('question.order', 'ASC')
        .addOrderBy('rule.order', 'ASC')
        .addOrderBy('condition.order', 'ASC')
        .getMany();
      return {
        rules,
        versionUpdatedAt: version.updatedAt.toISOString(),
      };
    });
  }

  async create(
    surveyId: string,
    versionId: string,
    questionId: string,
    dto: WriteApplicabilityRuleDto,
    actor: AuthenticatedUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const version = await this.assertMutableQuestion(
        manager,
        surveyId,
        versionId,
        questionId,
      );
      this.assertExpectedRevision(version, dto.expectedUpdatedAt);
      this.validate(dto);
      await this.assertDefaultAction(manager, questionId, dto.defaultAction);
      const rule = await manager.save(
        SurveyApplicabilityRule,
        manager.create(SurveyApplicabilityRule, {
          questionId,
          groupOperator: dto.groupOperator,
          action: dto.action,
          defaultAction: dto.defaultAction,
          order: dto.order,
        }),
      );
      await this.saveConditions(manager, rule.id, dto);
      await this.audit(
        manager,
        actor.id,
        'APPLICABILITY_RULE_CREATED',
        rule.id,
        {
          surveyId,
          versionId,
          questionId,
        },
      );
      const versionUpdatedAt = await this.touchVersion(manager, versionId);
      return {
        rule: await this.findRule(manager, rule.id),
        versionUpdatedAt,
      };
    });
  }

  /**
   * Agrega una misma regla a varias preguntas de forma atómica.
   *
   * La prioridad se calcula independientemente para cada pregunta, porque
   * cada una puede tener una cantidad distinta de reglas preexistentes.
   */
  async createBulk(
    surveyId: string,
    versionId: string,
    dto: BulkCreateApplicabilityRuleDto,
    actor: AuthenticatedUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      this.validate(dto.rule);
      const [firstQuestionId, ...remainingQuestionIds] = dto.questionIds;
      if (dto.questionIds.length < 2 || !firstQuestionId)
        throw new BadRequestException(
          'Seleccioná al menos dos preguntas para crear reglas.',
        );
      const version = await this.assertMutableQuestion(
        manager,
        surveyId,
        versionId,
        firstQuestionId,
      );
      this.assertExpectedRevision(version, dto.expectedUpdatedAt);
      for (const questionId of remainingQuestionIds) {
        await this.assertMutableQuestion(
          manager,
          surveyId,
          versionId,
          questionId,
        );
      }
      for (const questionId of dto.questionIds) {
        await this.assertDefaultAction(
          manager,
          questionId,
          dto.rule.defaultAction,
        );
      }

      const createdRuleIds: string[] = [];
      for (const questionId of dto.questionIds) {
        const lastRule = await manager.findOne(SurveyApplicabilityRule, {
          where: { questionId },
          order: { order: 'DESC' },
        });
        const rule = await manager.save(
          SurveyApplicabilityRule,
          manager.create(SurveyApplicabilityRule, {
            questionId,
            groupOperator: dto.rule.groupOperator,
            action: dto.rule.action,
            defaultAction: dto.rule.defaultAction,
            order: (lastRule?.order ?? -1) + 1,
          }),
        );
        await this.saveConditions(manager, rule.id, dto.rule);
        createdRuleIds.push(rule.id);
      }
      await this.audit(
        manager,
        actor.id,
        'APPLICABILITY_RULE_BULK_CREATED',
        versionId,
        {
          surveyId,
          versionId,
          questionIds: dto.questionIds,
          createdRuleIds,
        },
      );
      const versionUpdatedAt = await this.touchVersion(manager, versionId);
      return {
        rules: await Promise.all(
          createdRuleIds.map((ruleId) => this.findRule(manager, ruleId)),
        ),
        versionUpdatedAt,
      };
    });
  }

  async update(
    surveyId: string,
    versionId: string,
    questionId: string,
    ruleId: string,
    dto: WriteApplicabilityRuleDto,
    actor: AuthenticatedUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const version = await this.assertMutableQuestion(
        manager,
        surveyId,
        versionId,
        questionId,
      );
      this.assertExpectedRevision(version, dto.expectedUpdatedAt);
      const rule = await this.findRule(manager, ruleId);
      if (rule.questionId !== questionId)
        throw new NotFoundException('Regla no encontrada para la pregunta.');
      this.validate(dto);
      await this.assertDefaultAction(
        manager,
        questionId,
        dto.defaultAction,
        ruleId,
      );
      Object.assign(rule, {
        groupOperator: dto.groupOperator,
        action: dto.action,
        defaultAction: dto.defaultAction,
        order: dto.order,
      });
      await manager.save(rule);
      await manager.delete(SurveyApplicabilityCondition, { ruleId });
      await this.saveConditions(manager, ruleId, dto);
      await this.audit(
        manager,
        actor.id,
        'APPLICABILITY_RULE_UPDATED',
        ruleId,
        {
          surveyId,
          versionId,
          questionId,
        },
      );
      const versionUpdatedAt = await this.touchVersion(manager, versionId);
      return {
        rule: await this.findRule(manager, ruleId),
        versionUpdatedAt,
      };
    });
  }

  async remove(
    surveyId: string,
    versionId: string,
    questionId: string,
    ruleId: string,
    dto: SurveyVersionRevisionDto,
    actor: AuthenticatedUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const version = await this.assertMutableQuestion(
        manager,
        surveyId,
        versionId,
        questionId,
      );
      this.assertExpectedRevision(version, dto.expectedUpdatedAt);
      const rule = await this.findRule(manager, ruleId);
      if (rule.questionId !== questionId)
        throw new NotFoundException('Regla no encontrada para la pregunta.');
      await manager.delete(SurveyApplicabilityRule, ruleId);
      await this.audit(
        manager,
        actor.id,
        'APPLICABILITY_RULE_DELETED',
        ruleId,
        {
          surveyId,
          versionId,
          questionId,
        },
      );
      return {
        versionUpdatedAt: await this.touchVersion(manager, versionId),
      };
    });
  }

  async reorder(
    surveyId: string,
    versionId: string,
    questionId: string,
    dto: ReorderApplicabilityRulesDto,
    actor: AuthenticatedUser,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const version = await this.assertMutableQuestion(
        manager,
        surveyId,
        versionId,
        questionId,
      );
      this.assertExpectedRevision(version, dto.expectedUpdatedAt);
      const rules = await manager.findBy(SurveyApplicabilityRule, {
        questionId,
      });
      if (
        rules.length !== dto.ruleIds.length ||
        rules.some((rule) => !dto.ruleIds.includes(rule.id))
      )
        throw new BadRequestException(
          'El orden debe incluir exactamente todas las reglas de la pregunta.',
        );
      for (const [order, ruleId] of dto.ruleIds.entries())
        await manager.update(SurveyApplicabilityRule, ruleId, {
          order: order + rules.length,
        });
      for (const [order, ruleId] of dto.ruleIds.entries())
        await manager.update(SurveyApplicabilityRule, ruleId, { order });
      await this.audit(
        manager,
        actor.id,
        'APPLICABILITY_RULES_REORDERED',
        questionId,
        { surveyId, versionId, ruleIds: dto.ruleIds },
      );
      const versionUpdatedAt = await this.touchVersion(manager, versionId);
      return {
        rules: await this.findQuestionRules(manager, questionId),
        versionUpdatedAt,
      };
    });
  }

  async preview(
    surveyId: string,
    versionId: string,
    questionId: string,
    schoolId: string,
  ) {
    const periodYear = this.currentPeriodYear();
    const [ruleSnapshot, rectification] = await Promise.all([
      this.list(surveyId, versionId, questionId),
      this.dataSource.getRepository(SchoolRectification).findOne({
        where: { schoolId, periodYear },
        order: { rectifiedAt: 'DESC' },
      }),
    ]);
    if (!rectification)
      throw new ConflictException(
        `La escuela no tiene una rectificación confirmada para ${periodYear}.`,
      );
    return this.engine.evaluate(
      ruleSnapshot.rules,
      this.factsFromSnapshot(rectification.snapshot),
    );
  }

  validateRules(rules: SurveyApplicabilityRule[]) {
    const errors: string[] = [];
    const byQuestion = new Map<string, SurveyApplicabilityRule[]>();
    for (const rule of rules) {
      const questionRules = byQuestion.get(rule.questionId) ?? [];
      questionRules.push(rule);
      byQuestion.set(rule.questionId, questionRules);
      try {
        this.validate({
          groupOperator: rule.groupOperator,
          action: rule.action,
          defaultAction: rule.defaultAction,
          order: rule.order,
          conditions: rule.conditions,
        });
      } catch (error) {
        errors.push(
          error instanceof BadRequestException
            ? error.message
            : 'La regla de aplicabilidad no es válida.',
        );
      }
    }
    for (const [questionId, questionRules] of byQuestion) {
      if (
        new Set(questionRules.map(({ order }) => order)).size !==
        questionRules.length
      )
        errors.push(`La pregunta ${questionId} tiene prioridades repetidas.`);
      if (
        new Set(questionRules.map(({ defaultAction }) => defaultAction)).size >
        1
      )
        errors.push(
          `La pregunta ${questionId} tiene acciones predeterminadas contradictorias.`,
        );
      const signatures = new Map<string, ApplicabilityAction>();
      for (const rule of questionRules) {
        const signature = JSON.stringify({
          groupOperator: rule.groupOperator,
          conditions: [...rule.conditions]
            .sort((left, right) => left.order - right.order)
            .map(({ feature, operator, expectedValue }) => ({
              feature,
              operator,
              expectedValue,
            })),
        });
        const previousAction = signatures.get(signature);
        if (previousAction && previousAction !== rule.action)
          errors.push(
            `La pregunta ${questionId} tiene reglas idénticas con acciones contradictorias.`,
          );
        signatures.set(signature, rule.action);
      }
    }
    return errors;
  }

  private validate(dto: ApplicabilityRuleDefinitionDto) {
    if (!dto.conditions.length)
      throw new BadRequestException('Cada regla debe tener condiciones.');
    const orders = new Set<number>();
    for (const condition of dto.conditions) {
      if (orders.has(condition.order))
        throw new BadRequestException(
          'El orden de las condiciones no puede repetirse.',
        );
      orders.add(condition.order);
      const feature = getFeatureDefinition(condition.feature);
      if (!feature)
        throw new BadRequestException(
          `La característica ${condition.feature} no está soportada.`,
        );
      if (!feature.operators.includes(condition.operator))
        throw new BadRequestException(
          `El operador ${condition.operator} no es válido para ${feature.label}.`,
        );
      const value = condition.expectedValue;
      if (
        (feature.type === 'boolean' && typeof value !== 'boolean') ||
        (feature.type === 'number' && typeof value !== 'number') ||
        (feature.type === 'string' &&
          typeof value !== 'string' &&
          !Array.isArray(value)) ||
        (feature.type === 'string_array' &&
          typeof value !== 'string' &&
          !Array.isArray(value))
      )
        throw new BadRequestException(
          `El valor indicado no es válido para ${feature.label}.`,
        );
    }
  }

  private async assertMutableQuestion(
    manager: EntityManager,
    surveyId: string,
    versionId: string,
    questionId: string,
  ) {
    const version = await manager.findOne(SurveyVersion, {
      where: { id: versionId, surveyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    if (version.status !== SurveyVersionStatus.Draft)
      throw new ConflictException(
        'Las reglas sólo pueden modificarse en versiones borrador.',
      );

    const question = await manager
      .getRepository(SurveyQuestion)
      .createQueryBuilder('question')
      .innerJoin('question.section', 'section')
      .innerJoin('section.dimension', 'dimension')
      .innerJoin('dimension.version', 'version')
      .where('question.id = :questionId', { questionId })
      .andWhere('version.id = :versionId AND version.survey_id = :surveyId', {
        versionId,
        surveyId,
      })
      .select(['question.id'])
      .getRawOne<{ question_id: string }>();
    if (!question)
      throw new NotFoundException('Pregunta no encontrada en la versión.');
    return version;
  }

  private assertExpectedRevision(
    version: SurveyVersion,
    expectedUpdatedAt: string,
  ) {
    if (new Date(expectedUpdatedAt).getTime() === version.updatedAt.getTime())
      return;
    throw new ConflictException({
      code: 'SURVEY_VERSION_EDIT_CONFLICT',
      message:
        'Otra persona modificó esta versión mientras la estabas editando. Tus cambios no se guardaron; cargá la versión actual antes de continuar.',
      currentUpdatedAt: version.updatedAt.toISOString(),
    });
  }

  private async touchVersion(manager: EntityManager, versionId: string) {
    await manager.update(SurveyVersion, versionId, {
      updatedAt: () =>
        `GREATEST(clock_timestamp(), "updated_at" + interval '1 millisecond')`,
    });
    const updatedVersion = await manager.findOneBy(SurveyVersion, {
      id: versionId,
    });
    if (!updatedVersion) throw new NotFoundException('Versión no encontrada.');
    return updatedVersion.updatedAt.toISOString();
  }

  private async assertDefaultAction(
    manager: EntityManager,
    questionId: string,
    defaultAction: ApplicabilityAction,
    ignoredRuleId?: string,
  ) {
    const existing = await manager.findOneBy(SurveyApplicabilityRule, {
      questionId,
      ...(ignoredRuleId ? { id: Not(ignoredRuleId) } : {}),
    });
    if (existing && existing.defaultAction !== defaultAction)
      throw new BadRequestException(
        'Todas las reglas de una pregunta deben compartir la misma acción predeterminada.',
      );
  }

  private saveConditions(
    manager: EntityManager,
    ruleId: string,
    dto: ApplicabilityRuleDefinitionDto,
  ) {
    return manager.save(
      SurveyApplicabilityCondition,
      dto.conditions.map((condition) =>
        manager.create(SurveyApplicabilityCondition, { ...condition, ruleId }),
      ),
    );
  }

  private async findRule(manager: EntityManager, ruleId: string) {
    const rule = await manager.findOne(SurveyApplicabilityRule, {
      where: { id: ruleId },
      relations: { conditions: true },
      order: { conditions: { order: 'ASC' } },
    });
    if (!rule) throw new NotFoundException('Regla no encontrada.');
    return rule;
  }

  private findQuestionRules(manager: EntityManager, questionId: string) {
    return manager.find(SurveyApplicabilityRule, {
      where: { questionId },
      relations: { conditions: true },
      order: { order: 'ASC', conditions: { order: 'ASC' } },
    });
  }

  /**
   * Registro seguro de hechos escolares. Sólo usa claves conocidas y valores
   * copiados en el snapshot; nunca recorre rutas enviadas por el cliente.
   */
  factsFromSnapshot(snapshot: SchoolRectificationSnapshot) {
    return schoolApplicabilityFactsFromSnapshot(snapshot);
  }

  private currentPeriodYear() {
    return Number(
      new Intl.DateTimeFormat('en', {
        timeZone: 'America/Argentina/Mendoza',
        year: 'numeric',
      }).format(new Date()),
    );
  }

  private audit(
    manager: EntityManager,
    actorUserId: string,
    action: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    return manager.save(
      AuditLog,
      manager.create(AuditLog, {
        actorUserId,
        action,
        entityType: 'SurveyApplicabilityRule',
        entityId,
        changes,
      }),
    );
  }
}

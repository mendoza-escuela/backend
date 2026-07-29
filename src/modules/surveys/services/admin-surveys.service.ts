import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { CompareSurveyVersionsQueryDto } from '../dto/compare-survey-versions-query.dto';
import { CreateSurveyVersionDto } from '../dto/create-survey-version.dto';
import { CreateSurveyDto } from '../dto/create-survey.dto';
import { ListSurveysQueryDto } from '../dto/list-surveys-query.dto';
import { ImportSurveyVersionDto } from '../dto/import-survey-version.dto';
import {
  SurveyDimensionInputDto,
  UpdateSurveyVersionDto,
} from '../dto/update-survey-version.dto';
import { UpdateSurveyDto } from '../dto/update-survey.dto';
import { SurveyDimension } from '../entities/survey-dimension.entity';
import { SurveyOption } from '../entities/survey-option.entity';
import { SurveyQuestion } from '../entities/survey-question.entity';
import { SurveySection } from '../entities/survey-section.entity';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersionTemplate } from '../entities/survey-version-template.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { Survey } from '../entities/survey.entity';
import {
  createOfficialSurveyDimensionInputs,
  isOfficialSurveyStructure,
  OFFICIAL_SOCIOEMOTIONAL_QUESTION_NUMBERS,
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';
import { SurveyStructureValidator } from './survey-structure-validator.service';
import { SurveyVersionComparator } from './survey-version-comparator.service';
import { SurveyApplicabilityRule } from '../entities/survey-applicability-rule.entity';
import { SurveyApplicabilityCondition } from '../entities/survey-applicability-condition.entity';
import { ApplicabilityRulesService } from './applicability-rules.service';

@Injectable()
export class AdminSurveysService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly structureValidator: SurveyStructureValidator,
    private readonly comparator: SurveyVersionComparator,
    private readonly applicabilityRules: ApplicabilityRulesService,
  ) {}

  async list(query: ListSurveysQueryDto) {
    const builder = this.dataSource
      .getRepository(Survey)
      .createQueryBuilder('survey')
      .leftJoinAndSelect('survey.versions', 'version')
      .orderBy('survey.name', 'ASC')
      .addOrderBy('survey.id', 'ASC')
      .addOrderBy('version.versionNumber', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.search) {
      builder.andWhere(
        '(LOWER(survey.code) LIKE :search OR LOWER(survey.name) LIKE :search)',
        { search: `%${query.search.toLowerCase()}%` },
      );
    }

    const [surveys, total] = await builder.getManyAndCount();
    return {
      items: surveys.map((survey) => ({
        id: survey.id,
        code: survey.code,
        name: survey.name,
        description: survey.description,
        isActive: survey.isActive,
        createdAt: survey.createdAt,
        updatedAt: survey.updatedAt,
        versions: survey.versions.map((version) =>
          this.versionSummary(version),
        ),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async findOne(surveyId: string) {
    const survey = await this.getSurvey(surveyId);
    const versions = await this.dataSource.getRepository(SurveyVersion).find({
      where: { surveyId },
      order: { versionNumber: 'DESC' },
    });
    const versionIds = versions.map((version) => version.id);
    const auditBuilder = this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('audit')
      .leftJoinAndSelect('audit.actor', 'actor')
      .where(
        '(audit.entityType = :surveyType AND audit.entityId = :surveyId)',
        { surveyType: 'Survey', surveyId },
      );
    if (versionIds.length)
      auditBuilder.orWhere(
        '(audit.entityType = :versionType AND audit.entityId IN (:...versionIds))',
        { versionType: 'SurveyVersion', versionIds },
      );
    const [audits, countsByVersion] = await Promise.all([
      auditBuilder.orderBy('audit.createdAt', 'DESC').take(50).getMany(),
      this.structureCountsForVersions(versionIds),
    ]);

    return {
      id: survey.id,
      code: survey.code,
      name: survey.name,
      description: survey.description,
      isActive: survey.isActive,
      createdAt: survey.createdAt,
      updatedAt: survey.updatedAt,
      versions: versions.map((version) => ({
        ...this.versionSummary(version),
        counts: countsByVersion.get(version.id),
      })),
      audits: audits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        entityType: audit.entityType,
        entityId: audit.entityId,
        changes: audit.changes,
        createdAt: audit.createdAt,
        actor: audit.actor
          ? {
              id: audit.actor.id,
              firstName: audit.actor.firstName,
              lastName: audit.actor.lastName,
              email: audit.actor.email,
            }
          : null,
      })),
    };
  }

  async findVersion(surveyId: string, versionId: string) {
    await this.getSurvey(surveyId);
    const version = await this.getVersionWithContent(surveyId, versionId);
    return this.serializeVersion(version);
  }

  getOfficialDimensionsTemplate() {
    return {
      code: SurveyVersionTemplate.OfficialDimensions,
      dimensions: OFFICIAL_SURVEY_DIMENSIONS,
      questionAssignments: [
        {
          questionNumbers: OFFICIAL_SOCIOEMOTIONAL_QUESTION_NUMBERS,
          dimensionCode: OfficialSurveyDimensionCode.MentalHealth,
        },
      ],
    };
  }

  async createSurvey(dto: CreateSurveyDto, actor: AuthenticatedUser) {
    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const survey = await manager.save(
          Survey,
          manager.create(Survey, {
            code: this.normalizeCode(dto.code),
            name: dto.name.trim(),
            description: this.nullable(dto.description),
            isActive: dto.isActive ?? true,
          }),
        );
        await this.audit(
          manager,
          actor.id,
          'SURVEY_CREATED',
          'Survey',
          survey.id,
          {
            code: survey.code,
            name: survey.name,
            isActive: survey.isActive,
          },
        );
        return survey.id;
      });
      return this.findOne(id);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async updateSurvey(
    surveyId: string,
    dto: UpdateSurveyDto,
    actor: AuthenticatedUser,
  ) {
    try {
      await this.dataSource.transaction(async (manager) => {
        const survey = await manager.findOne(Survey, {
          where: { id: surveyId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!survey) throw new NotFoundException('Cuestionario no encontrado.');
        const before = this.surveySnapshot(survey);
        if (dto.code && this.normalizeCode(dto.code) !== survey.code) {
          const publishedCount = await manager.count(SurveyVersion, {
            where: { surveyId, status: SurveyVersionStatus.Published },
          });
          if (publishedCount)
            throw new ConflictException(
              'No se puede cambiar el código de un cuestionario con versiones publicadas.',
            );
          survey.code = this.normalizeCode(dto.code);
        }
        if (dto.name !== undefined) survey.name = dto.name.trim();
        if (dto.description !== undefined)
          survey.description = this.nullable(dto.description);
        if (dto.isActive !== undefined) survey.isActive = dto.isActive;
        await manager.save(Survey, survey);
        await this.audit(
          manager,
          actor.id,
          'SURVEY_UPDATED',
          'Survey',
          survey.id,
          {
            before,
            after: this.surveySnapshot(survey),
          },
        );
      });
      return this.findOne(surveyId);
    } catch (error) {
      this.rethrowUnique(error);
    }
  }

  async deleteSurvey(surveyId: string, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const survey = await manager.findOne(Survey, {
        where: { id: surveyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!survey) throw new NotFoundException('Cuestionario no encontrado.');
      const versions = await manager.findBy(SurveyVersion, { surveyId });
      if (
        versions.some((version) => version.status !== SurveyVersionStatus.Draft)
      )
        throw new ConflictException(
          'No se puede eliminar un cuestionario con versiones publicadas o archivadas. Desactivalo para conservar el historial.',
        );
      await this.audit(
        manager,
        actor.id,
        'SURVEY_DELETED',
        'Survey',
        survey.id,
        {
          ...this.surveySnapshot(survey),
          deletedDraftVersions: versions.length,
        },
      );
      if (versions.length)
        await manager.delete(
          SurveyVersion,
          versions.map((version) => version.id),
        );
      await manager.delete(Survey, survey.id);
    });
  }

  async createVersion(
    surveyId: string,
    dto: CreateSurveyVersionDto,
    actor: AuthenticatedUser,
  ) {
    if (dto.sourceVersionId && dto.template)
      throw new BadRequestException(
        'Elegí una versión de origen o una plantilla, no ambas opciones.',
      );

    const versionId = await this.dataSource.transaction(async (manager) => {
      const survey = await manager.findOne(Survey, {
        where: { id: surveyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!survey) throw new NotFoundException('Cuestionario no encontrado.');
      const latest = await manager.findOne(SurveyVersion, {
        where: { surveyId },
        order: { versionNumber: 'DESC' },
      });
      let source: SurveyVersion | null = null;
      if (dto.sourceVersionId)
        source = await this.getVersionWithContent(
          surveyId,
          dto.sourceVersionId,
          manager,
        );
      const version = await manager.save(
        SurveyVersion,
        manager.create(SurveyVersion, {
          surveyId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          title: dto.title.trim(),
          instructions:
            dto.instructions !== undefined
              ? this.nullable(dto.instructions)
              : (source?.instructions ?? null),
          status: SurveyVersionStatus.Draft,
          publishedAt: null,
        }),
      );
      if (source)
        await this.persistStructure(
          manager,
          version.id,
          this.versionToInput(source),
        );
      if (source)
        await this.cloneApplicabilityRules(manager, source, version.id);
      const selectedTemplate =
        dto.template ?? SurveyVersionTemplate.OfficialDimensions;
      if (
        !source &&
        selectedTemplate === SurveyVersionTemplate.OfficialDimensions
      )
        await this.persistStructure(
          manager,
          version.id,
          createOfficialSurveyDimensionInputs(),
        );
      await this.audit(
        manager,
        actor.id,
        source ? 'SURVEY_VERSION_CLONED' : 'SURVEY_VERSION_CREATED',
        'SurveyVersion',
        version.id,
        {
          surveyId,
          versionNumber: version.versionNumber,
          sourceVersionId: source?.id ?? null,
          template: source ? null : selectedTemplate,
        },
      );
      return version.id;
    });
    return this.findVersion(surveyId, versionId);
  }

  async createImportedVersion(
    surveyId: string,
    dto: ImportSurveyVersionDto,
    dimensions: SurveyDimensionInputDto[],
    actor: AuthenticatedUser,
  ) {
    this.structureValidator.validate(dimensions, false);
    const versionId = await this.dataSource.transaction(async (manager) => {
      const survey = await manager.findOne(Survey, {
        where: { id: surveyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!survey) throw new NotFoundException('Cuestionario no encontrado.');
      const latest = await manager.findOne(SurveyVersion, {
        where: { surveyId },
        order: { versionNumber: 'DESC' },
      });
      const version = await manager.save(
        SurveyVersion,
        manager.create(SurveyVersion, {
          surveyId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          title: dto.title.trim(),
          instructions: this.nullable(dto.instructions),
          status: SurveyVersionStatus.Draft,
          publishedAt: null,
        }),
      );
      await this.persistStructure(manager, version.id, dimensions);
      await this.audit(
        manager,
        actor.id,
        'SURVEY_VERSION_IMPORTED',
        'SurveyVersion',
        version.id,
        {
          surveyId,
          versionNumber: version.versionNumber,
          counts: this.inputCounts(dimensions),
        },
      );
      return version.id;
    });
    return this.findVersion(surveyId, versionId);
  }

  async updateVersion(
    surveyId: string,
    versionId: string,
    dto: UpdateSurveyVersionDto,
    actor: AuthenticatedUser,
  ) {
    this.structureValidator.validate(dto.dimensions, false);
    await this.dataSource.transaction(async (manager) => {
      const version = await this.getLockedVersion(manager, surveyId, versionId);
      this.assertDraft(version);
      const beforeVersion = await this.getVersionWithContent(
        surveyId,
        versionId,
        manager,
      );
      const beforeCounts = this.structureCounts(beforeVersion);
      version.title = dto.title.trim();
      version.instructions = this.nullable(dto.instructions);
      await manager.save(SurveyVersion, version);
      await manager.delete(SurveyDimension, { versionId });
      await this.persistStructure(manager, versionId, dto.dimensions);
      await this.cloneApplicabilityRules(manager, beforeVersion, versionId);
      await this.audit(
        manager,
        actor.id,
        'SURVEY_VERSION_UPDATED',
        'SurveyVersion',
        versionId,
        {
          surveyId,
          versionNumber: version.versionNumber,
          beforeCounts,
          afterCounts: this.inputCounts(dto.dimensions),
        },
      );
    });
    return this.findVersion(surveyId, versionId);
  }

  async publishVersion(
    surveyId: string,
    versionId: string,
    actor: AuthenticatedUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const version = await this.getLockedVersion(manager, surveyId, versionId);
      this.assertDraft(version);
      const withContent = await this.getVersionWithContent(
        surveyId,
        versionId,
        manager,
      );
      this.structureValidator.validate(this.versionToInput(withContent), true);
      const applicabilityErrors = this.applicabilityRules.validateRules(
        withContent.dimensions.flatMap((dimension) =>
          dimension.sections.flatMap((section) =>
            section.questions.flatMap(
              (question) => question.applicabilityRules ?? [],
            ),
          ),
        ),
      );
      if (applicabilityErrors.length)
        throw new BadRequestException({
          message: 'Las reglas de aplicabilidad contienen errores.',
          errors: applicabilityErrors,
        });
      version.status = SurveyVersionStatus.Published;
      version.publishedAt = new Date();
      await manager.save(SurveyVersion, version);
      await this.audit(
        manager,
        actor.id,
        'SURVEY_VERSION_PUBLISHED',
        'SurveyVersion',
        versionId,
        {
          surveyId,
          versionNumber: version.versionNumber,
          counts: this.structureCounts(withContent),
        },
      );
    });
    return this.findVersion(surveyId, versionId);
  }

  async archiveVersion(
    surveyId: string,
    versionId: string,
    actor: AuthenticatedUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const version = await this.getLockedVersion(manager, surveyId, versionId);
      if (version.status !== SurveyVersionStatus.Published)
        throw new ConflictException(
          'Sólo una versión publicada puede archivarse.',
        );
      const previousStatus = version.status;
      version.status = SurveyVersionStatus.Archived;
      await manager.save(SurveyVersion, version);
      await this.audit(
        manager,
        actor.id,
        'SURVEY_VERSION_ARCHIVED',
        'SurveyVersion',
        versionId,
        {
          surveyId,
          versionNumber: version.versionNumber,
          previousStatus,
          newStatus: SurveyVersionStatus.Archived,
        },
      );
    });
    return this.findVersion(surveyId, versionId);
  }

  async validateVersion(surveyId: string, versionId: string) {
    await this.getSurvey(surveyId);
    const version = await this.getVersionWithContent(surveyId, versionId);
    const errors = this.structureValidator.inspect(
      this.versionToInput(version),
      true,
    );
    return {
      valid: errors.length === 0,
      errors,
      counts: this.structureCounts(version),
    };
  }

  async deleteVersion(
    surveyId: string,
    versionId: string,
    actor: AuthenticatedUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const version = await this.getLockedVersion(manager, surveyId, versionId);
      this.assertDraft(version);
      await this.audit(
        manager,
        actor.id,
        'SURVEY_VERSION_DELETED',
        'SurveyVersion',
        versionId,
        { surveyId, versionNumber: version.versionNumber },
      );
      await manager.delete(SurveyVersion, versionId);
    });
  }

  async compareVersions(
    surveyId: string,
    query: CompareSurveyVersionsQueryDto,
  ) {
    await this.getSurvey(surveyId);
    const [from, to] = await Promise.all([
      this.getVersionWithContent(surveyId, query.fromVersionId),
      this.getVersionWithContent(surveyId, query.toVersionId),
    ]);
    return this.comparator.compare(from, to);
  }

  private async getSurvey(surveyId: string) {
    const survey = await this.dataSource
      .getRepository(Survey)
      .findOneBy({ id: surveyId });
    if (!survey) throw new NotFoundException('Cuestionario no encontrado.');
    return survey;
  }

  private async getVersionWithContent(
    surveyId: string,
    versionId: string,
    manager: EntityManager = this.dataSource.manager,
  ) {
    const version = await manager.findOne(SurveyVersion, {
      where: { id: versionId, surveyId },
      relations: {
        dimensions: {
          sections: {
            questions: {
              options: true,
              applicabilityRules: { conditions: true },
            },
          },
        },
      },
      order: {
        dimensions: {
          order: 'ASC',
          sections: {
            order: 'ASC',
            questions: { order: 'ASC', options: { order: 'ASC' } },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    return version;
  }

  private async getLockedVersion(
    manager: EntityManager,
    surveyId: string,
    versionId: string,
  ) {
    const version = await manager.findOne(SurveyVersion, {
      where: { id: versionId, surveyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    return version;
  }

  private assertDraft(version: SurveyVersion) {
    if (version.status !== SurveyVersionStatus.Draft)
      throw new ConflictException(
        'Sólo las versiones borrador pueden modificarse o eliminarse.',
      );
  }

  private async persistStructure(
    manager: EntityManager,
    versionId: string,
    dimensions: SurveyDimensionInputDto[],
  ) {
    for (const [dimensionOrder, dimensionInput] of dimensions.entries()) {
      const dimension = await manager.save(
        SurveyDimension,
        manager.create(SurveyDimension, {
          versionId,
          code: this.normalizeCode(dimensionInput.code),
          title: dimensionInput.title.trim(),
          description: this.nullable(dimensionInput.description),
          order: dimensionOrder,
        }),
      );
      for (const [
        sectionOrder,
        sectionInput,
      ] of dimensionInput.sections.entries()) {
        const section = await manager.save(
          SurveySection,
          manager.create(SurveySection, {
            dimensionId: dimension.id,
            code: this.normalizeCode(sectionInput.code),
            title: sectionInput.title.trim(),
            description: this.nullable(sectionInput.description),
            order: sectionOrder,
          }),
        );
        for (const [
          questionOrder,
          questionInput,
        ] of sectionInput.questions.entries()) {
          const question = await manager.save(
            SurveyQuestion,
            manager.create(SurveyQuestion, {
              sectionId: section.id,
              code: this.normalizeCode(questionInput.code),
              type: questionInput.type,
              prompt: questionInput.prompt.trim(),
              helpText: this.nullable(questionInput.helpText),
              required: questionInput.required,
              order: questionOrder,
              validation: questionInput.validation ?? {},
            }),
          );
          for (const [
            optionOrder,
            optionInput,
          ] of questionInput.options.entries())
            await manager.save(
              SurveyOption,
              manager.create(SurveyOption, {
                questionId: question.id,
                value: this.normalizeCode(optionInput.value),
                label: optionInput.label.trim(),
                helpText: this.nullable(optionInput.helpText),
                score: optionInput.score ?? null,
                order: optionOrder,
              }),
            );
        }
      }
    }
  }

  private async cloneApplicabilityRules(
    manager: EntityManager,
    source: SurveyVersion,
    targetVersionId: string,
  ) {
    const hasRules = source.dimensions.some((dimension) =>
      dimension.sections.some((section) =>
        section.questions.some(
          (question) => (question.applicabilityRules?.length ?? 0) > 0,
        ),
      ),
    );
    if (!hasRules) return;
    const target = await this.getVersionWithContent(
      source.surveyId,
      targetVersionId,
      manager,
    );
    const targetQuestions = new Map<string, SurveyQuestion>();
    for (const dimension of target.dimensions)
      for (const section of dimension.sections)
        for (const question of section.questions)
          targetQuestions.set(
            `${dimension.code}/${section.code}/${question.code}`,
            question,
          );

    for (const sourceDimension of source.dimensions)
      for (const sourceSection of sourceDimension.sections)
        for (const sourceQuestion of sourceSection.questions) {
          const targetQuestion = targetQuestions.get(
            `${sourceDimension.code}/${sourceSection.code}/${sourceQuestion.code}`,
          );
          if (!targetQuestion) continue;
          for (const sourceRule of sourceQuestion.applicabilityRules ?? []) {
            const targetRule = await manager.save(
              SurveyApplicabilityRule,
              manager.create(SurveyApplicabilityRule, {
                questionId: targetQuestion.id,
                groupOperator: sourceRule.groupOperator,
                action: sourceRule.action,
                defaultAction: sourceRule.defaultAction,
                order: sourceRule.order,
              }),
            );
            await manager.save(
              SurveyApplicabilityCondition,
              sourceRule.conditions.map((condition) =>
                manager.create(SurveyApplicabilityCondition, {
                  ruleId: targetRule.id,
                  feature: condition.feature,
                  operator: condition.operator,
                  expectedValue: condition.expectedValue,
                  order: condition.order,
                }),
              ),
            );
          }
        }
  }

  private versionToInput(version: SurveyVersion): SurveyDimensionInputDto[] {
    return version.dimensions.map((dimension) => ({
      code: dimension.code,
      title: dimension.title,
      description: dimension.description,
      sections: dimension.sections.map((section) => ({
        code: section.code,
        title: section.title,
        description: section.description,
        questions: section.questions.map((question) => ({
          code: question.code,
          type: question.type,
          prompt: question.prompt,
          helpText: question.helpText,
          required: question.required,
          validation: question.validation,
          options: question.options.map((option) => ({
            value: option.value,
            label: option.label,
            helpText: option.helpText,
            score: option.score,
          })),
        })),
      })),
    }));
  }

  private serializeVersion(version: SurveyVersion) {
    return {
      id: version.id,
      surveyId: version.surveyId,
      versionNumber: version.versionNumber,
      title: version.title,
      instructions: version.instructions,
      status: version.status,
      publishedAt: version.publishedAt,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      profile: isOfficialSurveyStructure(version.dimensions)
        ? 'institutional'
        : 'generic',
      dimensions: version.dimensions.map((dimension) => ({
        id: dimension.id,
        code: dimension.code,
        title: dimension.title,
        description: dimension.description,
        order: dimension.order,
        sections: dimension.sections.map((section) => ({
          id: section.id,
          code: section.code,
          title: section.title,
          description: section.description,
          order: section.order,
          questions: section.questions.map((question) => ({
            id: question.id,
            code: question.code,
            type: question.type,
            prompt: question.prompt,
            helpText: question.helpText,
            required: question.required,
            order: question.order,
            validation: question.validation,
            options: question.options.map((option) => ({
              id: option.id,
              value: option.value,
              label: option.label,
              helpText: option.helpText,
              score: option.score,
              order: option.order,
            })),
            applicabilityRules: (question.applicabilityRules ?? []).map(
              (rule) => ({
                id: rule.id,
                groupOperator: rule.groupOperator,
                action: rule.action,
                defaultAction: rule.defaultAction,
                order: rule.order,
                conditions: rule.conditions,
              }),
            ),
          })),
        })),
      })),
    };
  }

  private structureCounts(version: SurveyVersion) {
    return this.inputCounts(this.versionToInput(version));
  }

  /**
   * Cuenta la estructura de varias versiones mediante agregaciones SQL.
   *
   * Evita hidratar dimensiones, secciones, preguntas y opciones completas
   * cuando el detalle administrativo sólo necesita mostrar cantidades.
   */
  private async structureCountsForVersions(versionIds: string[]) {
    const counts = new Map<
      string,
      {
        dimensions: number;
        sections: number;
        questions: number;
        options: number;
      }
    >();
    versionIds.forEach((versionId) =>
      counts.set(versionId, {
        dimensions: 0,
        sections: 0,
        questions: 0,
        options: 0,
      }),
    );
    if (!versionIds.length) return counts;

    type CountRow = { versionId: string; count: string };
    const [dimensions, sections, questions, options] = await Promise.all([
      this.dataSource
        .getRepository(SurveyDimension)
        .createQueryBuilder('dimension')
        .select('dimension.versionId', 'versionId')
        .addSelect('COUNT(*)', 'count')
        .where('dimension.versionId IN (:...versionIds)', { versionIds })
        .groupBy('dimension.versionId')
        .getRawMany<CountRow>(),
      this.dataSource
        .getRepository(SurveySection)
        .createQueryBuilder('section')
        .innerJoin('section.dimension', 'dimension')
        .select('dimension.versionId', 'versionId')
        .addSelect('COUNT(*)', 'count')
        .where('dimension.versionId IN (:...versionIds)', { versionIds })
        .groupBy('dimension.versionId')
        .getRawMany<CountRow>(),
      this.dataSource
        .getRepository(SurveyQuestion)
        .createQueryBuilder('question')
        .innerJoin('question.section', 'section')
        .innerJoin('section.dimension', 'dimension')
        .select('dimension.versionId', 'versionId')
        .addSelect('COUNT(*)', 'count')
        .where('dimension.versionId IN (:...versionIds)', { versionIds })
        .groupBy('dimension.versionId')
        .getRawMany<CountRow>(),
      this.dataSource
        .getRepository(SurveyOption)
        .createQueryBuilder('option')
        .innerJoin('option.question', 'question')
        .innerJoin('question.section', 'section')
        .innerJoin('section.dimension', 'dimension')
        .select('dimension.versionId', 'versionId')
        .addSelect('COUNT(*)', 'count')
        .where('dimension.versionId IN (:...versionIds)', { versionIds })
        .groupBy('dimension.versionId')
        .getRawMany<CountRow>(),
    ]);

    for (const [key, rows] of [
      ['dimensions', dimensions],
      ['sections', sections],
      ['questions', questions],
      ['options', options],
    ] as const) {
      rows.forEach((row) => {
        const versionCounts = counts.get(row.versionId);
        if (versionCounts) versionCounts[key] = Number(row.count);
      });
    }
    return counts;
  }

  private inputCounts(dimensions: SurveyDimensionInputDto[]) {
    const sections = dimensions.flatMap((dimension) => dimension.sections);
    const questions = sections.flatMap((section) => section.questions);
    return {
      dimensions: dimensions.length,
      sections: sections.length,
      questions: questions.length,
      options: questions.reduce(
        (count, question) => count + question.options.length,
        0,
      ),
    };
  }

  private async loadCounts(
    manager: EntityManager,
    surveyId: string,
    versionId: string,
  ) {
    const version = await this.getVersionWithContent(
      surveyId,
      versionId,
      manager,
    );
    return this.structureCounts(version);
  }

  private versionSummary(version: SurveyVersion) {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      status: version.status,
      publishedAt: version.publishedAt,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
    };
  }

  private surveySnapshot(survey: Survey) {
    return {
      code: survey.code,
      name: survey.name,
      description: survey.description,
      isActive: survey.isActive,
    };
  }

  private nullable(value: string | null | undefined) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private normalizeCode(value: string) {
    return value.trim().toLowerCase();
  }

  private async audit(
    manager: EntityManager,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    changes: Record<string, unknown>,
  ) {
    await manager.save(AuditLog, {
      actorUserId,
      action,
      entityType,
      entityId,
      changes,
    });
  }

  private rethrowUnique(error: unknown): never {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    )
      throw new ConflictException(
        'Ya existe un cuestionario o elemento con ese código.',
      );
    throw error;
  }
}

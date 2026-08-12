import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { EvaluationConfiguration } from '../../evaluation-config/entities/evaluation-configuration.entity';
import { EvaluationConfigurationsService } from '../../evaluation-config/services/evaluation-configurations.service';
import { SchoolsService } from '../../schools/services/schools.service';
import { SurveyAnswer } from '../../submissions/entities/survey-answer.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { SurveyDimension } from '../../surveys/entities/survey-dimension.entity';
import { SurveyOption } from '../../surveys/entities/survey-option.entity';
import { SurveyQuestion } from '../../surveys/entities/survey-question.entity';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { isHistoricallyAvailableSurveyVersion } from '../../surveys/policies/survey-version-availability.policy';
import {
  SurveyApplicabilityService,
  type QuestionApplicabilityResolution,
  type SurveyApplicabilityResult,
} from '../../surveys/services/survey-applicability.service';
import {
  SurveyEvaluationService,
  type EvaluationQuestion,
  type SurveyEvaluationResult,
} from '../../surveys/services/survey-evaluation.service';
import {
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from '../../surveys/templates/official-survey-dimensions.template';
import {
  EVALUATION_ALGORITHM_VERSION,
  EVALUATION_SNAPSHOT_SCHEMA_VERSION,
  type EvaluationCalculationSource,
} from '../evaluation.constants';
import type {
  PreliminaryResultAnswerDto,
  PreliminaryResultDimensionDto,
  PreliminaryResultExcludedQuestionDto,
  PreliminaryResultQuestionDto,
  SchoolPreliminaryResultDto,
  SchoolPreliminaryResultListDto,
  SchoolPreliminaryResultSummaryDto,
} from '../dto/school-preliminary-result.dto';
import type {
  EvaluationDimensionSnapshot,
  EvaluationOptionSnapshot,
  EvaluationQuestionSnapshot,
  EvaluationSnapshot,
} from '../evaluation-snapshot.type';
import { EvaluationDimensionResult } from '../entities/evaluation-dimension-result.entity';
import { EvaluationResult } from '../entities/evaluation-result.entity';

type OrderedQuestion = {
  dimension: SurveyDimension;
  question: SurveyQuestion;
};

const MENTAL_HEALTH_DIMENSION_CODE = String(
  OfficialSurveyDimensionCode.MentalHealth,
);

type PreparedCalculation = {
  evaluation: SurveyEvaluationResult;
  answerByQuestionId: Map<string, SurveyAnswer>;
  dimensionRows: Array<{
    dimensionId: string;
    dimensionCode: string;
    dimensionTitle: string;
    order: number;
    numerator: string;
    denominator: number;
    score: string | null;
    isCritical: boolean;
    criticalValue: string | null;
    criticalThreshold: string | null;
    criticalRuleVersion: string | null;
  }>;
};

type StarDecision = {
  baseStars: number;
  finalStars: number;
  blockingReasons: string[];
  alerts: Array<Record<string, unknown>>;
  configurationSnapshot: ReturnType<
    EvaluationConfigurationsService['snapshot']
  >;
};

type EvaluationCalculationOptions = {
  /**
   * Configuración histórica que debe reutilizar un recálculo. Los cálculos
   * iniciales omiten esta opción y continúan usando la configuración activa.
   */
  configuration?: EvaluationConfiguration;
};

@Injectable()
export class EvaluationResultsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly evaluationService: SurveyEvaluationService,
    private readonly applicabilityService: SurveyApplicabilityService,
    private readonly schoolsService: SchoolsService,
    private readonly configurations: EvaluationConfigurationsService,
  ) {}

  /**
   * Calcula y persiste el resultado actual dentro de la transacción recibida.
   *
   * El bloqueo pesimista de la presentación serializa cálculos concurrentes.
   * La restricción única por presentación constituye una segunda defensa.
   */
  async calculateAndPersist(
    manager: EntityManager,
    submission: SurveySubmission,
    surveyVersion: SurveyVersion,
    applicability: SurveyApplicabilityResult,
    actorUserId: string | null,
    source: EvaluationCalculationSource,
    options: EvaluationCalculationOptions = {},
  ): Promise<EvaluationResult> {
    const lockedSubmission = await manager.findOne(SurveySubmission, {
      where: { id: submission.id },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (!lockedSubmission) {
      throw new NotFoundException('La presentación indicada no existe.');
    }

    const configuration =
      options.configuration ?? (await this.configurations.active(manager));
    const calculation = this.prepareCalculation(
      submission,
      surveyVersion,
      applicability,
      configuration,
    );
    const starDecision = this.starDecision(configuration, calculation);
    const calculatedAt = new Date();
    const existingResult = await manager.findOne(EvaluationResult, {
      where: { submissionId: submission.id },
      lock: { mode: 'pessimistic_write' },
    });
    const result = existingResult ?? manager.create(EvaluationResult);

    Object.assign(result, {
      submissionId: submission.id,
      campaignId: submission.campaignId,
      schoolId: submission.schoolId,
      surveyVersionId: surveyVersion.id,
      generalScore: calculation.evaluation.general.average,
      generalNumerator: String(calculation.evaluation.general.numerator),
      generalDenominator: calculation.evaluation.general.denominator,
      algorithmVersion: EVALUATION_ALGORITHM_VERSION,
      snapshotSchemaVersion: EVALUATION_SNAPSHOT_SCHEMA_VERSION,
      snapshot: this.buildSnapshot(
        submission,
        surveyVersion,
        applicability,
        calculation.evaluation,
        calculation.answerByQuestionId,
        calculatedAt,
        starDecision,
      ),
      calculatedAt,
      calculatedByUserId: actorUserId,
      calculationSource: source,
      stars: starDecision.finalStars,
      baseStars: starDecision.baseStars,
      starRuleVersion: configuration.versionCode,
      starBlockingReasons: starDecision.blockingReasons,
      evaluationConfigurationId: configuration.id,
      evaluationConfigurationVersion: configuration.versionCode,
      evaluationRuleSnapshot: starDecision.configurationSnapshot,
      evaluationAlerts: starDecision.alerts,
    });

    try {
      const savedResult = await manager.save(EvaluationResult, result);
      await manager.delete(EvaluationDimensionResult, {
        resultId: savedResult.id,
      });
      const dimensionResults = calculation.dimensionRows.map((dimension) =>
        manager.create(EvaluationDimensionResult, {
          resultId: savedResult.id,
          ...dimension,
        }),
      );
      savedResult.dimensionResults = await manager.save(
        EvaluationDimensionResult,
        dimensionResults,
      );
      const mentalHealth = savedResult.dimensionResults.find(
        ({ dimensionCode }) => dimensionCode === MENTAL_HEALTH_DIMENSION_CODE,
      );

      await manager.save(
        AuditLog,
        manager.create(AuditLog, {
          actorUserId,
          action: existingResult
            ? 'EVALUATION_RESULT_RECALCULATED'
            : 'EVALUATION_RESULT_CREATED',
          entityType: 'EvaluationResult',
          entityId: savedResult.id,
          changes: {
            submissionId: submission.id,
            campaignId: submission.campaignId,
            schoolId: submission.schoolId,
            surveyVersionId: surveyVersion.id,
            algorithmVersion: EVALUATION_ALGORITHM_VERSION,
            calculationSource: source,
            generalScore: savedResult.generalScore,
            mentalHealthCritical: mentalHealth?.isCritical ?? false,
            mentalHealthValue: mentalHealth?.criticalValue ?? null,
            baseStars: starDecision.baseStars,
            finalStars: starDecision.finalStars,
            evaluationConfigurationVersion: configuration.versionCode,
            calculatedAt: calculatedAt.toISOString(),
          },
        }),
      );
      return savedResult;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new ConflictException(
        'No fue posible guardar el resultado completo. No se conservaron cambios parciales.',
      );
    }
  }

  /**
   * Recalcula una sola presentación usando exclusivamente sus datos históricos
   * persistidos. No modifica respuestas y no constituye un recálculo masivo.
   */
  async recalculateSubmission(
    submissionId: string,
    actorUserId: string | null,
    source: EvaluationCalculationSource = 'single_recalculation',
  ): Promise<EvaluationResult> {
    return this.dataSource.transaction((manager) =>
      this.recalculateSubmissionWithManager(
        manager,
        submissionId,
        actorUserId,
        source,
      ),
    );
  }

  /**
   * Variante transaccional reutilizable por reparaciones controladas. La
   * presentación se bloquea y todo el resultado se reconstruye desde sus
   * respuestas y decisiones históricas persistidas.
   */
  async recalculateSubmissionWithManager(
    manager: EntityManager,
    submissionId: string,
    actorUserId: string | null,
    source: EvaluationCalculationSource = 'single_recalculation',
  ): Promise<EvaluationResult> {
    const lockedSubmission = await manager.findOne(SurveySubmission, {
      where: { id: submissionId },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (!lockedSubmission) {
      throw new NotFoundException('La presentación indicada no existe.');
    }

    const submission = await manager.findOne(SurveySubmission, {
      where: { id: submissionId },
      relations: {
        answers: { option: true },
        applicabilityDecisions: true,
        surveyVersion: {
          survey: true,
          dimensions: {
            sections: {
              questions: {
                options: true,
                applicabilityRules: { conditions: true },
              },
            },
          },
        },
      },
      order: {
        surveyVersion: {
          dimensions: {
            order: 'ASC',
            sections: {
              order: 'ASC',
              questions: {
                order: 'ASC',
                options: { order: 'ASC' },
                applicabilityRules: {
                  order: 'ASC',
                  conditions: { order: 'ASC' },
                },
              },
            },
          },
        },
      },
    });
    if (!submission) {
      throw new NotFoundException('La presentación indicada no existe.');
    }
    if (submission.status !== SubmissionStatus.Submitted) {
      throw new ConflictException(
        'Sólo pueden recalcularse presentaciones enviadas.',
      );
    }

    const previousResult = await manager.findOne(EvaluationResult, {
      where: { submissionId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!previousResult) {
      throw new ConflictException({
        code: 'EVALUATION_RECALCULATION_RESULT_REQUIRED',
        message:
          'La presentación no posee un resultado histórico que pueda recalcularse de forma segura.',
      });
    }
    if (previousResult.algorithmVersion !== EVALUATION_ALGORITHM_VERSION) {
      throw new ConflictException({
        code: 'EVALUATION_RECALCULATION_ALGORITHM_DRIFT',
        message:
          'El resultado fue generado con otra versión del algoritmo y requiere una migración específica.',
        storedAlgorithmVersion: previousResult.algorithmVersion,
        currentAlgorithmVersion: EVALUATION_ALGORITHM_VERSION,
      });
    }
    if (!previousResult.evaluationConfigurationId) {
      throw new ConflictException({
        code: 'EVALUATION_RECALCULATION_CONFIGURATION_REQUIRED',
        message:
          'El resultado no identifica la configuración histórica necesaria para recalcularlo.',
      });
    }

    let historicalConfiguration: EvaluationConfiguration;
    try {
      historicalConfiguration = await this.configurations.get(
        previousResult.evaluationConfigurationId,
        manager,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ConflictException({
          code: 'EVALUATION_RECALCULATION_CONFIGURATION_REQUIRED',
          message:
            'La configuración histórica del resultado ya no está disponible.',
        });
      }
      throw error;
    }
    if (
      previousResult.evaluationConfigurationVersion &&
      previousResult.evaluationConfigurationVersion !==
        historicalConfiguration.versionCode
    ) {
      throw new ConflictException({
        code: 'EVALUATION_RECALCULATION_CONFIGURATION_DRIFT',
        message:
          'La configuración histórica no coincide con la versión registrada en el resultado.',
        storedConfigurationVersion:
          previousResult.evaluationConfigurationVersion,
        resolvedConfigurationVersion: historicalConfiguration.versionCode,
      });
    }

    return this.calculateAndPersist(
      manager,
      submission,
      submission.surveyVersion,
      this.applicabilityFromStoredDecisions(submission),
      actorUserId,
      source,
      { configuration: historicalConfiguration },
    );
  }

  /**
   * Resuelve la escuela desde la sesión. No admite un schoolId del cliente, por
   * lo que un perfil escuela no puede consultar resultados de otra institución.
   */
  async resultForSchool(
    campaignId: string,
    actor: AuthenticatedUser,
  ): Promise<SchoolPreliminaryResultDto> {
    const { school } = await this.schoolsService.evaluationContextForUser(
      actor.id,
    );
    const submission = await this.dataSource
      .getRepository(SurveySubmission)
      .findOne({
        where: {
          campaignId,
          schoolId: school.id,
        },
        select: {
          id: true,
          status: true,
          submittedAt: true,
        },
      });

    if (!submission) {
      throw new NotFoundException({
        code: 'SUBMISSION_NOT_FOUND',
        message: 'La escuela no posee una presentación para esta campaña.',
      });
    }
    if (submission.status !== SubmissionStatus.Submitted) {
      throw new ConflictException({
        code: 'SUBMISSION_DRAFT',
        message:
          'La presentación todavía está en borrador. El resultado estará disponible después del envío.',
      });
    }

    const result = await this.dataSource
      .getRepository(EvaluationResult)
      .findOne({
        where: {
          submissionId: submission.id,
          schoolId: school.id,
        },
        relations: { campaign: true },
      });

    if (!result) {
      throw new NotFoundException({
        code: 'PRELIMINARY_RESULT_NOT_GENERATED',
        message:
          'La presentación fue enviada, pero el resultado preliminar todavía no fue generado.',
      });
    }
    return this.preliminaryResult(result, submission);
  }

  /**
   * Lista únicamente resultados persistidos de la escuela autenticada. La
   * pertenencia nunca se recibe desde el frontend.
   */
  async resultsForSchool(
    actor: AuthenticatedUser,
  ): Promise<SchoolPreliminaryResultListDto> {
    const { school } = await this.schoolsService.evaluationContextForUser(
      actor.id,
    );
    const results = await this.dataSource.getRepository(EvaluationResult).find({
      where: {
        schoolId: school.id,
        submission: { status: SubmissionStatus.Submitted },
      },
      relations: {
        campaign: true,
        submission: true,
      },
      order: { calculatedAt: 'DESC' },
    });

    return {
      items: results.map((result) => this.preliminaryResultSummary(result)),
    };
  }

  private prepareCalculation(
    submission: SurveySubmission,
    surveyVersion: SurveyVersion,
    applicability: SurveyApplicabilityResult,
    configuration: EvaluationConfiguration,
  ): PreparedCalculation {
    this.assertSubmissionAndVersion(submission, surveyVersion);
    const orderedQuestions = this.orderedQuestions(surveyVersion);
    const questionById = new Map(
      orderedQuestions.map(({ question }) => [question.id, question]),
    );
    const answerByQuestionId = this.validateAnswers(
      submission.answers,
      questionById,
      submission.id,
    );
    this.validateApplicability(
      submission,
      surveyVersion,
      applicability,
      questionById,
    );
    this.validateOptionScores(orderedQuestions.map(({ question }) => question));

    const evaluationQuestions: EvaluationQuestion[] = orderedQuestions
      .filter(({ question }) =>
        applicability.applicableQuestionIds.has(question.id),
      )
      .map(({ dimension, question }) => {
        if (!question.options.length) {
          throw new BadRequestException(
            `La pregunta ${question.code} es aplicable pero no posee opciones puntuables.`,
          );
        }
        return {
          id: question.id,
          code: question.code,
          dimensionId: dimension.id,
          dimensionCode: dimension.code,
          required: question.required,
          options: question.options.map(({ id, score }) => ({ id, score })),
          applicabilityRules: [],
        };
      });
    const evaluationAnswers = submission.answers.flatMap((answer) =>
      answer.optionId
        ? [{ questionId: answer.questionId, optionId: answer.optionId }]
        : [],
    );
    const evaluation = this.evaluationService.evaluateApplicable(
      evaluationQuestions,
      evaluationAnswers,
    );

    if (evaluation.validationErrors.length) {
      throw new BadRequestException({
        message: 'El resultado calculado contiene respuestas inválidas.',
        errors: evaluation.validationErrors,
      });
    }
    this.assertEvaluationConsistency(
      evaluation,
      evaluationQuestions,
      answerByQuestionId,
    );

    const resultByDimensionId = new Map(
      evaluation.dimensions.map((dimension) => [
        dimension.dimensionId,
        dimension,
      ]),
    );
    const dimensionRows = surveyVersion.dimensions.map((dimension) => {
      const calculated = resultByDimensionId.get(dimension.id);
      const score = calculated?.average ?? null;
      return {
        dimensionId: dimension.id,
        dimensionCode: dimension.code,
        dimensionTitle: dimension.title,
        order: dimension.order,
        numerator: String(calculated?.numerator ?? 0),
        denominator: calculated?.denominator ?? 0,
        score,
        ...this.criticalityForDimension(dimension.code, score, configuration),
      };
    });

    if (dimensionRows.length !== 6) {
      throw new BadRequestException(
        'El resultado debe contener exactamente las seis dimensiones oficiales.',
      );
    }
    const mentalHealth = dimensionRows.find(
      ({ dimensionCode }) => dimensionCode === MENTAL_HEALTH_DIMENSION_CODE,
    );
    if (!mentalHealth || mentalHealth.score === null) {
      throw new BadRequestException(
        'No fue posible calcular la dimensión Salud Mental mediante su código oficial.',
      );
    }
    return { evaluation, answerByQuestionId, dimensionRows };
  }

  private assertSubmissionAndVersion(
    submission: SurveySubmission,
    surveyVersion: SurveyVersion,
  ): void {
    if (!submission?.id) {
      throw new NotFoundException('La presentación indicada no existe.');
    }
    if (
      submission.status !== SubmissionStatus.Submitted ||
      !surveyVersion?.id ||
      submission.surveyVersionId !== surveyVersion.id ||
      !isHistoricallyAvailableSurveyVersion(
        surveyVersion.status,
        surveyVersion.publishedAt,
      ) ||
      !surveyVersion.survey
    ) {
      throw new BadRequestException(
        'La versión del cuestionario asociada a la presentación no es válida.',
      );
    }
    if (!submission.schoolProfileSnapshot) {
      throw new BadRequestException(
        'El snapshot de la ficha escolar de la presentación está incompleto.',
      );
    }

    const officialCodes = new Set(
      OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => dimension.code as string),
    );
    const versionCodes = new Set(
      surveyVersion.dimensions.map((dimension) => dimension.code),
    );
    if (
      surveyVersion.dimensions.length !== 6 ||
      versionCodes.size !== 6 ||
      [...officialCodes].some((code) => !versionCodes.has(code))
    ) {
      throw new BadRequestException(
        'La versión debe contener exactamente las seis dimensiones oficiales.',
      );
    }
  }

  private orderedQuestions(surveyVersion: SurveyVersion): OrderedQuestion[] {
    const questions: OrderedQuestion[] = [];
    for (const dimension of surveyVersion.dimensions) {
      if (dimension.versionId !== surveyVersion.id) {
        throw new BadRequestException(
          `La dimensión ${dimension.code} no pertenece a la versión evaluada.`,
        );
      }
      for (const section of dimension.sections) {
        if (section.dimensionId !== dimension.id) {
          throw new BadRequestException(
            `La sección ${section.code} no pertenece a la dimensión evaluada.`,
          );
        }
        for (const question of section.questions) {
          if (question.sectionId !== section.id) {
            throw new BadRequestException(
              `La pregunta ${question.code} no pertenece a la versión evaluada.`,
            );
          }
          if (
            question.options.some(
              (option) => option.questionId !== question.id,
            ) ||
            question.applicabilityRules.some(
              (rule) =>
                rule.questionId !== question.id ||
                rule.conditions.some(
                  (condition) => condition.ruleId !== rule.id,
                ),
            )
          ) {
            throw new BadRequestException(
              `La estructura de opciones o reglas de ${question.code} no corresponde a la versión evaluada.`,
            );
          }
          questions.push({ dimension, question });
        }
      }
    }
    return questions;
  }

  private validateAnswers(
    answers: SurveyAnswer[],
    questionById: Map<string, SurveyQuestion>,
    submissionId: string,
  ): Map<string, SurveyAnswer> {
    const answerByQuestionId = new Map<string, SurveyAnswer>();
    for (const answer of answers) {
      const question = questionById.get(answer.questionId);
      if (
        answer.submissionId !== submissionId ||
        !question ||
        answerByQuestionId.has(answer.questionId)
      ) {
        throw new BadRequestException(
          'Existe una respuesta asociada a una pregunta de otra versión o duplicada.',
        );
      }
      if (
        answer.optionId &&
        !question.options.some((option) => option.id === answer.optionId)
      ) {
        throw new BadRequestException(
          `La respuesta de la pregunta ${question.code} utiliza una opción inválida.`,
        );
      }
      answerByQuestionId.set(answer.questionId, answer);
    }
    return answerByQuestionId;
  }

  private validateApplicability(
    submission: SurveySubmission,
    surveyVersion: SurveyVersion,
    applicability: SurveyApplicabilityResult,
    questionById: Map<string, SurveyQuestion>,
  ): void {
    if (
      applicability.surveyVersionId !== surveyVersion.id ||
      applicability.status !== 'ready' ||
      applicability.decisions.length !== questionById.size
    ) {
      throw new BadRequestException(
        'El snapshot de aplicabilidad está incompleto.',
      );
    }

    const seenQuestionIds = new Set<string>();
    for (const decision of applicability.decisions) {
      const question = questionById.get(decision.questionId);
      if (
        !question ||
        seenQuestionIds.has(decision.questionId) ||
        decision.surveyVersionId !== surveyVersion.id
      ) {
        throw new BadRequestException(
          'La aplicabilidad contiene una pregunta de otra versión o duplicada.',
        );
      }
      seenQuestionIds.add(decision.questionId);
      if (
        decision.status === 'excluded' &&
        (!decision.reasonCode || !decision.reasonDescription)
      ) {
        throw new BadRequestException(
          `La pregunta excluida ${question.code} no posee un motivo de exclusión completo.`,
        );
      }
      if (
        decision.appliedRuleId &&
        !question.applicabilityRules.some(
          (rule) => rule.id === decision.appliedRuleId,
        )
      ) {
        throw new BadRequestException(
          `La aplicabilidad de la pregunta ${question.code} referencia una regla inválida.`,
        );
      }
    }

    const storedDecisions = submission.applicabilityDecisions ?? [];
    const storedByQuestionId = new Map(
      storedDecisions.map((decision) => [decision.questionId, decision]),
    );
    if (
      storedDecisions.length !== questionById.size ||
      applicability.decisions.some((decision) => {
        const stored = storedByQuestionId.get(decision.questionId);
        return (
          !stored ||
          stored.surveyVersionId !== surveyVersion.id ||
          !seenQuestionIds.has(stored.questionId) ||
          stored.status !== decision.status ||
          stored.appliedRuleId !== decision.appliedRuleId ||
          stored.reasonCode !== decision.reasonCode ||
          stored.reasonDescription !== decision.reasonDescription ||
          JSON.stringify(stored.missingFeatures) !==
            JSON.stringify(decision.missingFeatures) ||
          JSON.stringify(stored.relevantSchoolFacts) !==
            JSON.stringify(decision.relevantSchoolFacts)
        );
      })
    ) {
      throw new BadRequestException(
        'Las decisiones persistidas no corresponden a la versión evaluada.',
      );
    }
  }

  private validateOptionScores(questions: SurveyQuestion[]): void {
    for (const question of questions) {
      for (const option of question.options) {
        this.requiredOptionScore(option, question.code);
      }
    }
  }

  private requiredOptionScore(
    option: SurveyOption,
    questionCode: string,
  ): number {
    if (
      option.score === null ||
      !Number.isInteger(option.score) ||
      option.score < 0 ||
      option.score > 100
    ) {
      throw new BadRequestException(
        `La opción ${option.value} de la pregunta ${questionCode} posee un puntaje inválido.`,
      );
    }
    return option.score;
  }

  private assertEvaluationConsistency(
    evaluation: SurveyEvaluationResult,
    questions: EvaluationQuestion[],
    answerByQuestionId: Map<string, SurveyAnswer>,
  ): void {
    const expectedNumerator = questions.reduce((total, question) => {
      const answer = answerByQuestionId.get(question.id);
      const option = question.options.find(
        (candidate) => candidate.id === answer?.optionId,
      );
      return total + (option?.score ?? 0);
    }, 0);

    if (
      evaluation.general.denominator !== questions.length ||
      evaluation.general.numerator !== expectedNumerator ||
      evaluation.general.average === null ||
      Number(evaluation.general.average) < 0 ||
      Number(evaluation.general.average) > 100 ||
      !this.averageIsCoherent(
        Number(evaluation.general.average),
        expectedNumerator,
        questions.length,
      )
    ) {
      throw new BadRequestException(
        'El puntaje general no es coherente con las respuestas y puntajes utilizados.',
      );
    }

    for (const dimension of evaluation.dimensions) {
      if (
        dimension.average === null ||
        Number(dimension.average) < 0 ||
        Number(dimension.average) > 100 ||
        !this.averageIsCoherent(
          Number(dimension.average),
          dimension.numerator,
          dimension.denominator,
        )
      ) {
        throw new BadRequestException(
          `El puntaje de la dimensión ${dimension.dimensionCode} es inválido.`,
        );
      }
    }
  }

  private averageIsCoherent(
    average: number,
    numerator: number,
    denominator: number,
  ): boolean {
    return (
      denominator > 0 &&
      Math.abs(average - numerator / denominator) <= 0.00000001
    );
  }

  private buildSnapshot(
    submission: SurveySubmission,
    surveyVersion: SurveyVersion,
    applicability: SurveyApplicabilityResult,
    evaluation: SurveyEvaluationResult,
    answerByQuestionId: Map<string, SurveyAnswer>,
    calculatedAt: Date,
    starDecision: StarDecision,
  ): EvaluationSnapshot {
    if (!submission.schoolProfileSnapshot) {
      throw new BadRequestException(
        'El snapshot de la ficha escolar de la presentación está incompleto.',
      );
    }
    const schoolSnapshot = submission.schoolProfileSnapshot;
    const decisionByQuestionId = new Map(
      applicability.decisions.map((decision) => [
        decision.questionId,
        decision,
      ]),
    );
    const dimensionResultById = new Map(
      evaluation.dimensions.map((dimension) => [
        dimension.dimensionId,
        dimension,
      ]),
    );
    const dimensions: EvaluationDimensionSnapshot[] =
      surveyVersion.dimensions.map((dimension) => {
        const result = dimensionResultById.get(dimension.id);
        return {
          id: dimension.id,
          code: dimension.code,
          title: dimension.title,
          description: dimension.description,
          order: dimension.order,
          result: {
            numerator: String(result?.numerator ?? 0),
            denominator: result?.denominator ?? 0,
            score: result?.average ?? null,
            criticality: this.snapshotCriticality(
              dimension.code,
              result?.average ?? null,
              starDecision,
            ),
          },
          sections: dimension.sections.map((section) => ({
            id: section.id,
            code: section.code,
            title: section.title,
            description: section.description,
            order: section.order,
            questions: section.questions.map((question) =>
              this.questionSnapshot(
                question,
                decisionByQuestionId,
                answerByQuestionId,
              ),
            ),
          })),
        };
      });

    const snapshot: EvaluationSnapshot = {
      schemaVersion: EVALUATION_SNAPSHOT_SCHEMA_VERSION,
      algorithm: {
        version: EVALUATION_ALGORITHM_VERSION,
        calculatedAt: calculatedAt.toISOString(),
      },
      result: {
        generalScore: evaluation.general.average as string,
        numerator: String(evaluation.general.numerator),
        denominator: evaluation.general.denominator,
        stars: {
          value: starDecision.finalStars,
          baseValue: starDecision.baseStars,
          ruleVersion: starDecision.configurationSnapshot.versionCode,
          blockingReasons: starDecision.blockingReasons,
          configuration: starDecision.configurationSnapshot,
          alerts: starDecision.alerts,
        },
      },
      submission: {
        id: submission.id,
        campaignId: submission.campaignId,
        schoolId: submission.schoolId,
        surveyVersionId: submission.surveyVersionId,
        schoolRectificationId: submission.schoolRectificationId,
        submittedAt: this.toIsoString(submission.submittedAt),
        originalRespondent: structuredClone(
          submission.originalRespondentSnapshot,
        ),
      },
      school: structuredClone(schoolSnapshot),
      survey: {
        id: surveyVersion.survey.id,
        code: surveyVersion.survey.code,
        name: surveyVersion.survey.name,
        description: surveyVersion.survey.description,
        version: {
          id: surveyVersion.id,
          number: surveyVersion.versionNumber,
          title: surveyVersion.title,
          instructions: surveyVersion.instructions,
          publishedAt: this.toIsoString(surveyVersion.publishedAt) as string,
        },
        dimensions,
      },
    };
    this.assertSnapshotComplete(snapshot);
    return snapshot;
  }

  private questionSnapshot(
    question: SurveyQuestion,
    decisionByQuestionId: Map<string, QuestionApplicabilityResolution>,
    answerByQuestionId: Map<string, SurveyAnswer>,
  ): EvaluationQuestionSnapshot {
    const decision = decisionByQuestionId.get(question.id);
    if (!decision) {
      throw new BadRequestException(
        `Falta la decisión de aplicabilidad de la pregunta ${question.code}.`,
      );
    }
    const answer = answerByQuestionId.get(question.id);
    const selectedOption = question.options.find(
      (option) => option.id === answer?.optionId,
    );

    return {
      id: question.id,
      code: question.code,
      type: question.type,
      prompt: question.prompt,
      helpText: question.helpText,
      required: question.required,
      order: question.order,
      validation: structuredClone(question.validation),
      options: question.options.map((option) =>
        this.optionSnapshot(option, question.code),
      ),
      rules: question.applicabilityRules.map((rule) => ({
        id: rule.id,
        order: rule.order,
        groupOperator: rule.groupOperator,
        action: rule.action,
        defaultAction: rule.defaultAction,
        conditions: rule.conditions.map((condition) => ({
          id: condition.id,
          order: condition.order,
          feature: condition.feature,
          operator: condition.operator,
          expectedValue: structuredClone(condition.expectedValue),
        })),
      })),
      applicability: {
        ...structuredClone(decision),
        evaluatedAt: decision.evaluatedAt.toISOString(),
      },
      answer: answer
        ? {
            id: answer.id,
            optionId: answer.optionId,
            value: structuredClone(answer.value),
            selectedOption: selectedOption
              ? this.optionSnapshot(selectedOption, question.code)
              : null,
          }
        : null,
      scoreUsed:
        decision.status === 'applicable' && selectedOption
          ? String(this.requiredOptionScore(selectedOption, question.code))
          : null,
    };
  }

  private optionSnapshot(
    option: SurveyOption,
    questionCode: string,
  ): EvaluationOptionSnapshot {
    return {
      id: option.id,
      value: option.value,
      label: option.label,
      helpText: option.helpText,
      score: this.requiredOptionScore(option, questionCode),
      order: option.order,
    };
  }

  private assertSnapshotComplete(snapshot: EvaluationSnapshot): void {
    const starConfiguration = snapshot.result.stars.configuration;
    if (
      !snapshot.algorithm.version ||
      !snapshot.algorithm.calculatedAt ||
      !snapshot.school ||
      !snapshot.survey.version.id ||
      !snapshot.survey.version.publishedAt ||
      snapshot.survey.dimensions.length !== 6 ||
      snapshot.result.stars.value === null ||
      snapshot.result.stars.value < 1 ||
      snapshot.result.stars.value > 5 ||
      !snapshot.result.stars.ruleVersion ||
      !starConfiguration ||
      snapshot.survey.dimensions.some((dimension) =>
        dimension.code === MENTAL_HEALTH_DIMENSION_CODE
          ? !dimension.result.criticality ||
            dimension.result.criticality.threshold !==
              starConfiguration?.mentalHealthCriticalThreshold ||
            dimension.result.criticality.ruleVersion !==
              starConfiguration?.versionCode
          : dimension.result.criticality !== null,
      ) ||
      snapshot.survey.dimensions.some((dimension) =>
        dimension.sections.some((section) =>
          section.questions.some(
            (question) =>
              !question.applicability ||
              (question.applicability.status === 'excluded' &&
                (!question.applicability.reasonCode ||
                  !question.applicability.reasonDescription)),
          ),
        ),
      )
    ) {
      throw new BadRequestException(
        'El snapshot del resultado está incompleto.',
      );
    }
  }

  private applicabilityFromStoredDecisions(
    submission: SurveySubmission,
  ): SurveyApplicabilityResult {
    const stored = submission.applicabilityDecisions ?? [];
    if (!stored.length) {
      throw new BadRequestException(
        'La presentación no posee decisiones de aplicabilidad persistidas.',
      );
    }
    const questionCodes = new Map(
      this.orderedQuestions(submission.surveyVersion).map(({ question }) => [
        question.id,
        question.code,
      ]),
    );
    const decisions: QuestionApplicabilityResolution[] = stored.map(
      (decision) => ({
        questionId: decision.questionId,
        questionCode: questionCodes.get(decision.questionId) ?? '',
        surveyVersionId: decision.surveyVersionId,
        status: decision.status,
        appliedRuleId: decision.appliedRuleId,
        reasonCode: decision.reasonCode,
        reasonDescription: decision.reasonDescription,
        missingFeatures: [...decision.missingFeatures],
        relevantSchoolFacts: structuredClone(
          decision.relevantSchoolFacts,
        ) as QuestionApplicabilityResolution['relevantSchoolFacts'],
        evaluatedAt: decision.evaluatedAt,
      }),
    );
    return this.applicabilityService.result(
      submission.surveyVersionId,
      decisions,
      'persisted',
    );
  }

  private toIsoString(value: Date | string | null): string | null {
    return value ? new Date(value).toISOString() : null;
  }

  /**
   * Construye el contrato público exclusivamente desde el resultado y su
   * snapshot histórico. No consulta la ficha ni el cuestionario actuales.
   */
  private preliminaryResult(
    result: EvaluationResult,
    submission: Pick<SurveySubmission, 'id' | 'status' | 'submittedAt'>,
  ): SchoolPreliminaryResultDto {
    const snapshot = result.snapshot;
    this.assertReadablePreliminarySnapshot(result, submission);
    const warnings: string[] = [];
    let structurallyComplete = true;
    const dimensionsByCode = new Map(
      snapshot.survey.dimensions.map((dimension) => [
        dimension.code,
        dimension,
      ]),
    );
    const dimensions: PreliminaryResultDimensionDto[] =
      OFFICIAL_SURVEY_DIMENSIONS.map((officialDimension) => {
        const dimension = dimensionsByCode.get(officialDimension.code);
        if (!dimension) {
          structurallyComplete = false;
          warnings.push(
            `No se encontró el resultado histórico de ${officialDimension.title}.`,
          );
          return {
            id: null,
            code: officialDimension.code,
            title: officialDimension.title,
            order: officialDimension.order,
            score: null,
            available: false,
            isCritical: false,
            criticalValue: null,
            criticalThreshold: null,
          };
        }
        const score = this.optionalDisplayScore(
          dimension.result.score,
          dimension.title,
          warnings,
        );
        if (dimension.result.score !== null && score === null) {
          structurallyComplete = false;
        }
        const criticality = dimension.result.criticality;
        return {
          id: dimension.id,
          code: dimension.code,
          title: dimension.title,
          order: dimension.order,
          score,
          available: score !== null,
          isCritical: criticality?.isCritical ?? false,
          criticalValue: this.optionalDisplayScore(
            criticality?.value ?? null,
            `criticidad de ${dimension.title}`,
            warnings,
          ),
          criticalThreshold: this.optionalDisplayScore(
            criticality?.threshold ?? null,
            `umbral de ${dimension.title}`,
            warnings,
          ),
        };
      });
    const unknownDimensionCount =
      snapshot.survey.dimensions.length - dimensionsByCode.size;
    if (unknownDimensionCount > 0) {
      warnings.push(
        'El snapshot contiene dimensiones históricas duplicadas que no se muestran.',
      );
      structurallyComplete = false;
    }

    const orderedQuestions = [...snapshot.survey.dimensions]
      .sort((left, right) => left.order - right.order)
      .flatMap((dimension) =>
        [...dimension.sections]
          .sort((left, right) => left.order - right.order)
          .flatMap((section) =>
            [...section.questions]
              .sort((left, right) => left.order - right.order)
              .map((question) => ({
                question,
                context: this.preliminaryQuestion(dimension, section, question),
              })),
          ),
      );
    const applicableQuestions = orderedQuestions
      .filter(({ question }) => question.applicability.status === 'applicable')
      .map(({ context }) => context);
    const excludedQuestions: PreliminaryResultExcludedQuestionDto[] =
      orderedQuestions
        .filter(({ question }) => question.applicability.status === 'excluded')
        .map(({ question, context }) => ({
          ...context,
          exclusion: {
            reasonCode: question.applicability.reasonCode,
            reason: question.applicability.reasonDescription,
          },
        }));
    const answers: PreliminaryResultAnswerDto[] = orderedQuestions.flatMap(
      ({ question, context }) => {
        if (
          question.applicability.status !== 'applicable' ||
          !question.answer
        ) {
          return [];
        }
        return [
          {
            ...context,
            answer: {
              optionId: question.answer.optionId,
              optionLabel: question.answer.selectedOption?.label ?? null,
              value: structuredClone(question.answer.value),
              scoreUsed: this.optionalDisplayScore(
                question.scoreUsed,
                `puntaje de la pregunta ${question.code}`,
                warnings,
              ),
            },
          },
        ];
      },
    );
    const mentalHealth = dimensions.find(
      ({ code }) => code === MENTAL_HEALTH_DIMENSION_CODE,
    );

    return {
      id: result.id,
      submission: {
        id: snapshot.submission.id,
        submittedAt: snapshot.submission.submittedAt as string,
      },
      school: {
        id: snapshot.submission.schoolId,
        cue: snapshot.school.cue,
        name: snapshot.school.name,
      },
      campaign: {
        id: result.campaignId,
        name: result.campaign.name,
        type: String(result.campaign.type),
      },
      survey: {
        id: snapshot.survey.id,
        code: snapshot.survey.code,
        name: snapshot.survey.name,
        version: {
          id: snapshot.survey.version.id,
          number: snapshot.survey.version.number,
          title: snapshot.survey.version.title,
          publishedAt: snapshot.survey.version.publishedAt,
        },
      },
      result: {
        generalScore: this.requiredDisplayScore(
          snapshot.result.generalScore,
          'puntaje general',
        ),
        numerator: Number(snapshot.result.numerator),
        denominator: snapshot.result.denominator,
        stars: {
          available: snapshot.result.stars.value !== null,
          base: snapshot.result.stars.baseValue ?? snapshot.result.stars.value,
          final: snapshot.result.stars.value,
          wasLimited:
            snapshot.result.stars.baseValue !== undefined &&
            snapshot.result.stars.baseValue !== snapshot.result.stars.value,
          maxWhenMentalHealthCritical:
            snapshot.result.stars.configuration?.mentalHealthMaxStars ?? null,
          configurationVersion:
            snapshot.result.stars.configuration?.versionCode ??
            snapshot.result.stars.ruleVersion,
          blockingReasons: snapshot.result.stars.blockingReasons,
        },
        alerts: (snapshot.result.stars.alerts ?? []).flatMap((alert) => {
          const threshold = Number(alert.threshold);
          const observedValue = Number(alert.observedValue);
          const starsBefore = Number(alert.starsBefore);
          const starsAfter = Number(alert.starsAfter);
          return typeof alert.code === 'string' &&
            typeof alert.severity === 'string' &&
            typeof alert.dimensionCode === 'string' &&
            Number.isFinite(threshold) &&
            Number.isFinite(observedValue) &&
            Number.isInteger(starsBefore) &&
            Number.isInteger(starsAfter)
            ? [
                {
                  code: alert.code,
                  severity: alert.severity,
                  dimensionCode: alert.dimensionCode,
                  threshold,
                  observedValue,
                  message:
                    typeof alert.message === 'string' ? alert.message : '',
                  causedBlocking: Boolean(alert.causedBlocking),
                  starsBefore,
                  starsAfter,
                },
              ]
            : [];
        }),
        dimensions,
        mentalHealthCritical: {
          isCritical: mentalHealth?.isCritical ?? false,
          value: mentalHealth?.criticalValue ?? null,
          threshold: mentalHealth?.criticalThreshold ?? null,
        },
      },
      applicableQuestions,
      excludedQuestions,
      answers,
      calculation: {
        calculatedAt: snapshot.algorithm.calculatedAt,
        algorithmVersion: snapshot.algorithm.version,
        snapshotSchemaVersion: snapshot.schemaVersion,
      },
      dataQuality: {
        complete: structurallyComplete && warnings.length === 0,
        warnings: [...new Set(warnings)],
      },
    };
  }

  private preliminaryResultSummary(
    result: EvaluationResult,
  ): SchoolPreliminaryResultSummaryDto {
    const snapshot = result.snapshot;
    if (
      !result.campaign ||
      !snapshot?.submission?.submittedAt ||
      !snapshot.school?.name
    ) {
      throw new UnprocessableEntityException({
        code: 'HISTORICAL_RESULT_INCOMPLETE',
        message:
          'Uno de los resultados históricos está incompleto y no puede mostrarse.',
      });
    }
    return {
      id: result.id,
      submissionId: result.submissionId,
      campaign: {
        id: result.campaignId,
        name: result.campaign.name,
        type: String(result.campaign.type),
      },
      schoolName: snapshot.school.name,
      submittedAt: snapshot.submission.submittedAt,
      generalScore: this.requiredDisplayScore(
        snapshot.result.generalScore,
        'puntaje general',
      ),
      stars: snapshot.result.stars.value,
      calculatedAt: snapshot.algorithm.calculatedAt,
    };
  }

  private preliminaryQuestion(
    dimension: EvaluationDimensionSnapshot,
    section: EvaluationDimensionSnapshot['sections'][number],
    question: EvaluationQuestionSnapshot,
  ): PreliminaryResultQuestionDto {
    return {
      id: question.id,
      code: question.code,
      prompt: question.prompt,
      order: question.order,
      dimension: {
        id: dimension.id,
        code: dimension.code,
        title: dimension.title,
        order: dimension.order,
      },
      section: {
        id: section.id,
        code: section.code,
        title: section.title,
        order: section.order,
      },
    };
  }

  private assertReadablePreliminarySnapshot(
    result: EvaluationResult,
    submission: Pick<SurveySubmission, 'id' | 'status' | 'submittedAt'>,
  ): void {
    const snapshot = result.snapshot;
    if (
      !result.campaign ||
      !snapshot?.submission ||
      !snapshot.submission.submittedAt ||
      snapshot.submission.id !== submission.id ||
      snapshot.submission.campaignId !== result.campaignId ||
      snapshot.submission.schoolId !== result.schoolId ||
      snapshot.submission.surveyVersionId !== result.surveyVersionId ||
      !snapshot.school?.name ||
      !snapshot.school.cue ||
      !snapshot.survey?.version ||
      !Array.isArray(snapshot.survey.dimensions) ||
      snapshot.survey.dimensions.some(
        (dimension) =>
          !dimension?.id ||
          !dimension.code ||
          !dimension.title ||
          !dimension.result ||
          !Array.isArray(dimension.sections) ||
          dimension.sections.some(
            (section) =>
              !section?.id ||
              !section.title ||
              !Array.isArray(section.questions) ||
              section.questions.some(
                (question) =>
                  !question?.id ||
                  !question.code ||
                  !question.prompt ||
                  !question.applicability,
              ),
          ),
      ) ||
      !snapshot.algorithm?.version ||
      !snapshot.algorithm.calculatedAt
    ) {
      throw new UnprocessableEntityException({
        code: 'HISTORICAL_RESULT_INCOMPLETE',
        message:
          'Los datos históricos del resultado están incompletos y no pueden mostrarse.',
      });
    }
  }

  private requiredDisplayScore(value: string, label: string): number {
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new UnprocessableEntityException({
        code: 'HISTORICAL_RESULT_INCOMPLETE',
        message: `El ${label} almacenado no es válido.`,
      });
    }
    return score;
  }

  private optionalDisplayScore(
    value: string | null,
    label: string,
    warnings: string[],
  ): number | null {
    if (value === null) return null;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      warnings.push(`El ${label} histórico no está disponible.`);
      return null;
    }
    return score;
  }

  private criticalityForDimension(
    dimensionCode: string,
    score: string | null,
    configuration: EvaluationConfiguration,
  ): Pick<
    PreparedCalculation['dimensionRows'][number],
    'isCritical' | 'criticalValue' | 'criticalThreshold' | 'criticalRuleVersion'
  > {
    if (dimensionCode !== MENTAL_HEALTH_DIMENSION_CODE) {
      return {
        isCritical: false,
        criticalValue: null,
        criticalThreshold: null,
        criticalRuleVersion: null,
      };
    }
    return {
      isCritical:
        score !== null &&
        Number(score) < Number(configuration.mentalHealthCriticalThreshold),
      criticalValue: score,
      criticalThreshold: configuration.mentalHealthCriticalThreshold,
      criticalRuleVersion: configuration.versionCode,
    };
  }

  private snapshotCriticality(
    dimensionCode: string,
    score: string | null,
    starDecision: StarDecision,
  ): EvaluationDimensionSnapshot['result']['criticality'] {
    if (dimensionCode !== MENTAL_HEALTH_DIMENSION_CODE) return null;
    const configuration = {
      mentalHealthCriticalThreshold:
        starDecision.configurationSnapshot.mentalHealthCriticalThreshold,
      versionCode: starDecision.configurationSnapshot.versionCode,
    } as EvaluationConfiguration;
    const criticality = this.criticalityForDimension(
      dimensionCode,
      score,
      configuration,
    );
    return {
      isCritical: criticality.isCritical,
      value: criticality.criticalValue,
      threshold:
        starDecision.configurationSnapshot.mentalHealthCriticalThreshold,
      operator: 'less_than',
      ruleVersion: starDecision.configurationSnapshot.versionCode,
    };
  }

  private starDecision(
    configuration: EvaluationConfiguration,
    calculation: PreparedCalculation,
  ): StarDecision {
    const generalScore = Number(calculation.evaluation.general.average);
    const mentalHealth = calculation.dimensionRows.find(
      ({ dimensionCode }) => dimensionCode === MENTAL_HEALTH_DIMENSION_CODE,
    );
    if (!mentalHealth || mentalHealth.score === null)
      throw new BadRequestException(
        'No se encontró el resultado de Salud Mental.',
      );
    const decision = this.configurations.evaluate(
      configuration,
      generalScore,
      Number(mentalHealth.score),
    );
    const { baseStars, finalStars } = decision;
    const blocked = decision.causedBlocking;
    const isCritical = decision.isMentalHealthCritical;
    const blockingReasons = blocked ? ['CRITICAL_MENTAL_HEALTH'] : [];
    const alerts = isCritical
      ? [
          {
            code: 'CRITICAL_MENTAL_HEALTH',
            type: 'critical_dimension',
            severity: 'critical',
            dimensionCode: MENTAL_HEALTH_DIMENSION_CODE,
            threshold: configuration.mentalHealthCriticalThreshold,
            observedValue: mentalHealth.score,
            message:
              'La dimensión Salud Mental se encuentra por debajo del umbral crítico configurado.',
            configurationVersion: configuration.versionCode,
            causedBlocking: blocked,
            starsBefore: baseStars,
            starsAfter: finalStars,
          },
        ]
      : [];
    return {
      baseStars,
      finalStars,
      blockingReasons,
      alerts,
      configurationSnapshot: this.configurations.snapshot(configuration),
    };
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isDeepStrictEqual } from 'node:util';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { CampaignsService } from '../../campaigns/services/campaigns.service';
import { CampaignSchoolsService } from '../../campaigns/services/campaign-schools.service';
import { EvaluationResultsService } from '../../evaluation/services/evaluation-results.service';
import { SchoolsService } from '../../schools/services/schools.service';
import { SurveyQuestionType } from '../../surveys/entities/survey-question-type.enum';
import {
  SurveyQuestion,
  SurveyQuestionValidation,
} from '../../surveys/entities/survey-question.entity';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { isHistoricallyAvailableSurveyVersion } from '../../surveys/policies/survey-version-availability.policy';
import {
  QuestionApplicabilityResolution,
  SurveyApplicabilityResult,
  SurveyApplicabilityService,
} from '../../surveys/services/survey-applicability.service';
import { SaveSubmissionDraftDto } from '../dto/save-submission-draft.dto';
import { SubmissionQuestionApplicability } from '../entities/submission-question-applicability.entity';
import { SubmissionStatus } from '../entities/submission-status.enum';
import {
  SurveyAnswer,
  SurveyAnswerValue,
} from '../entities/survey-answer.entity';
import { SurveySubmission } from '../entities/survey-submission.entity';

@Injectable()
export class SubmissionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly campaignsService: CampaignsService,
    private readonly campaignSchoolsService: CampaignSchoolsService,
    private readonly schoolsService: SchoolsService,
    private readonly surveyApplicability: SurveyApplicabilityService,
    private readonly evaluationResults: EvaluationResultsService,
  ) {}

  async availableCampaigns(actor: AuthenticatedUser) {
    const { school, rectification } =
      await this.schoolsService.evaluationContextForUser(actor.id);
    const campaigns = await this.campaignsService.operationalCampaigns(
      school.id,
    );
    const now = new Date();
    const historicalDrafts = (
      await this.dataSource.getRepository(SurveySubmission).find({
        where: {
          schoolId: school.id,
          status: SubmissionStatus.Draft,
        },
        relations: {
          campaign: { surveyVersion: { survey: true } },
        },
        order: {
          campaign: { endsAt: 'DESC' },
          startedAt: 'DESC',
        },
      })
    ).filter((submission) => this.isExpiredDraft(submission, now.getTime()));
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const submissions = campaignIds.length
      ? await this.dataSource.getRepository(SurveySubmission).find({
          where: {
            schoolId: school.id,
            campaignId: In(campaignIds),
          },
        })
      : [];
    await this.loadSubmissionCollections([...historicalDrafts, ...submissions]);
    const submissionsByCampaign = new Map(
      submissions.map((submission) => [submission.campaignId, submission]),
    );
    const questionCounts = await this.questionCounts([
      ...campaigns.map((campaign) => campaign.surveyVersionId),
      ...historicalDrafts.map((submission) => submission.surveyVersionId),
    ]);

    return {
      school: {
        id: school.id,
        cue: school.cue,
        name: school.name,
        isActive: school.isActive,
      },
      rectification,
      items: campaigns.map((campaign) => {
        const submission = submissionsByCampaign.get(campaign.id);
        const totalQuestions =
          questionCounts.get(campaign.surveyVersionId) ?? 0;
        return {
          ...this.campaignSummary(campaign),
          canStart: school.isActive && rectification.isEvaluationReady,
          blockingReason: this.blockingReason(
            school.isActive,
            rectification.isConfirmed,
            rectification.isEvaluationReady,
          ),
          submission: submission
            ? this.submissionSummary(submission, totalQuestions)
            : null,
        };
      }),
      expiredDrafts: historicalDrafts.map((submission) => ({
        ...this.campaignSummary(submission.campaign),
        canStart: false,
        readOnly: true,
        blockingReason:
          'La etapa ya no se encuentra abierta. El borrador está disponible en modo de sólo lectura.',
        submission: this.submissionSummary(
          submission,
          questionCounts.get(submission.surveyVersionId) ?? 0,
        ),
      })),
    };
  }

  async startOrGet(campaignId: string, actor: AuthenticatedUser) {
    let submissionId: string | null = null;
    try {
      submissionId = await this.dataSource.transaction(async (manager) => {
        const context = await this.schoolsService.evaluationContextForUser(
          actor.id,
          manager,
        );
        await this.schoolsService.assertActiveForEvaluation(
          context.school.id,
          manager,
        );
        const { school, rectification } = context;
        const campaign = await this.campaignsService.assertOperational(
          campaignId,
          manager,
        );
        await this.campaignSchoolsService.assertAssigned(
          campaignId,
          school.id,
          manager,
        );
        const existing = await manager.findOne(SurveySubmission, {
          where: { campaignId, schoolId: school.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing) return existing.id;
        if (
          !rectification.isEvaluationReady ||
          !rectification.id ||
          !rectification.snapshot
        ) {
          const missingLabels = rectification.missingFields
            .map(({ label }) => label)
            .join(', ');
          throw new ConflictException(
            rectification.isConfirmed
              ? `La ficha escolar fue confirmada para ${rectification.periodYear}, pero requiere actualización antes de comenzar.${
                  missingLabels ? ` Datos pendientes: ${missingLabels}.` : ''
                }`
              : `Antes de comenzar debés confirmar la ficha escolar para ${rectification.periodYear}.`,
          );
        }

        const submission = await manager.save(
          SurveySubmission,
          manager.create(SurveySubmission, {
            campaignId: campaign.id,
            schoolId: school.id,
            surveyVersionId: campaign.surveyVersionId,
            schoolRectificationId: rectification.id,
            schoolProfileSnapshot: structuredClone(rectification.snapshot),
            originalRespondentId: actor.id,
            originalRespondentSnapshot: {
              id: actor.id,
              firstName: actor.firstName,
              lastName: actor.lastName,
              email: actor.email,
            },
            status: SubmissionStatus.Draft,
            startedAt: new Date(),
            lastSavedAt: null,
            submittedAt: null,
          }),
        );
        await this.audit(
          manager,
          actor.id,
          'SUBMISSION_STARTED',
          submission.id,
          {
            campaignId: campaign.id,
            schoolId: school.id,
            surveyVersionId: campaign.surveyVersionId,
            schoolRectificationId: rectification.id,
          },
        );
        return submission.id;
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const context = await this.schoolsService.evaluationContextForUser(
        actor.id,
      );
      submissionId =
        (
          await this.dataSource.getRepository(SurveySubmission).findOneBy({
            campaignId,
            schoolId: context.school.id,
          })
        )?.id ?? null;
    }
    if (!submissionId)
      throw new ConflictException(
        'No se pudo iniciar la presentación. Intentá nuevamente.',
      );
    return this.workspace(campaignId, actor);
  }

  async workspace(campaignId: string, actor: AuthenticatedUser) {
    const { school, submission, applicability, campaignOpen } =
      await this.dataSource.transaction(async (manager) => {
        const context = await this.schoolsService.evaluationContextForUser(
          actor.id,
          manager,
        );
        await this.schoolsService.assertActiveForEvaluation(
          context.school.id,
          manager,
        );
        const accessState = await this.getSubmissionAccessState(
          manager,
          campaignId,
          context.school.id,
        );
        const shouldLock =
          accessState.status === SubmissionStatus.Draft &&
          this.isCampaignOpen(accessState.campaign);
        const loaded = await this.getSubmission(
          manager,
          campaignId,
          context.school.id,
          shouldLock,
        );
        const open = this.isCampaignOpen(loaded.campaign);
        // Un borrador sólo puede recalcular o adoptar datos si fue cargado bajo
        // bloqueo de escritura y la etapa continúa abierta al revalidarla.
        const campaignOpen =
          loaded.status === SubmissionStatus.Draft ? shouldLock && open : open;
        if (campaignOpen && loaded.status === SubmissionStatus.Draft)
          await this.refreshDraftRectification(
            manager,
            loaded,
            context.rectification,
            actor.id,
          );
        return {
          school: context.school,
          submission: loaded,
          applicability: await this.resolveApplicability(
            manager,
            loaded,
            loaded.surveyVersion,
            { readOnly: !campaignOpen },
          ),
          campaignOpen,
        };
      });
    return this.serializeWorkspace(
      submission,
      applicability,
      school.isActive &&
        campaignOpen &&
        submission.status === SubmissionStatus.Draft,
      !school.isActive
        ? 'El establecimiento está inactivo.'
        : !campaignOpen
          ? 'La etapa ya no se encuentra abierta.'
          : submission.status === SubmissionStatus.Submitted
            ? 'La presentación ya fue enviada y es de sólo lectura.'
            : null,
    );
  }

  async saveDraft(
    campaignId: string,
    dto: SaveSubmissionDraftDto,
    actor: AuthenticatedUser,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const context = await this.schoolsService.evaluationContextForUser(
        actor.id,
        manager,
      );
      await this.schoolsService.assertActiveForEvaluation(
        context.school.id,
        manager,
      );
      const { school, rectification } = context;
      await this.campaignsService.assertOperational(campaignId, manager);
      await this.campaignSchoolsService.assertAssigned(
        campaignId,
        school.id,
        manager,
      );
      const submission = await this.getSubmission(
        manager,
        campaignId,
        school.id,
        true,
      );
      this.assertDraft(submission);
      await this.refreshDraftRectification(
        manager,
        submission,
        rectification,
        actor.id,
      );
      const version =
        submission.surveyVersion ??
        (await this.getVersion(manager, submission.surveyVersionId));
      const applicability = await this.resolveApplicability(
        manager,
        submission,
        version,
      );
      const answers = this.validateAnswers(version, dto, applicability);

      if (applicability.applicableQuestionIds.size)
        await manager.delete(SurveyAnswer, {
          submissionId: submission.id,
          questionId: In([...applicability.applicableQuestionIds]),
        });
      if (answers.length)
        await manager.save(
          SurveyAnswer,
          answers.map((answer) =>
            manager.create(SurveyAnswer, {
              submissionId: submission.id,
              ...answer,
            }),
          ),
        );
      submission.lastSavedAt = new Date();
      await manager.update(SurveySubmission, submission.id, {
        lastSavedAt: submission.lastSavedAt,
      });
    });
    return this.workspace(campaignId, actor);
  }

  async submit(campaignId: string, actor: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const context = await this.schoolsService.evaluationContextForUser(
        actor.id,
        manager,
      );
      await this.schoolsService.assertActiveForEvaluation(
        context.school.id,
        manager,
      );
      const { school, rectification } = context;
      await this.campaignsService.assertOperational(campaignId, manager);
      await this.campaignSchoolsService.assertAssigned(
        campaignId,
        school.id,
        manager,
      );
      const submission = await this.getSubmission(
        manager,
        campaignId,
        school.id,
        true,
      );
      this.assertDraft(submission);
      await this.refreshDraftRectification(
        manager,
        submission,
        rectification,
        actor.id,
      );
      const version =
        submission.surveyVersion ??
        (await this.getVersion(manager, submission.surveyVersionId));
      const applicability = await this.resolveApplicability(
        manager,
        submission,
        version,
      );
      this.assertApplicabilityComplete(applicability);
      const applicableQuestions = this.questions(version).filter((question) =>
        applicability.applicableQuestionIds.has(question.id),
      );
      const missing = applicableQuestions
        .filter((question) => question.required)
        .filter(
          (question) =>
            !submission.answers.some(
              (answer) => answer.questionId === question.id,
            ),
        );
      if (missing.length)
        throw new BadRequestException(
          `Faltan ${missing.length} preguntas obligatorias: ${missing
            .slice(0, 5)
            .map((question) => question.code)
            .join(', ')}${missing.length > 5 ? '…' : ''}.`,
        );

      submission.status = SubmissionStatus.Submitted;
      submission.submittedAt = new Date();
      submission.lastSavedAt ??= submission.submittedAt;
      await manager.update(SurveySubmission, submission.id, {
        status: submission.status,
        submittedAt: submission.submittedAt,
        lastSavedAt: submission.lastSavedAt,
      });
      const result = await this.evaluationResults.calculateAndPersist(
        manager,
        submission,
        version,
        applicability,
        actor.id,
        'submission_finalization',
      );
      await this.audit(
        manager,
        actor.id,
        'SUBMISSION_SUBMITTED',
        submission.id,
        {
          campaignId,
          schoolId: school.id,
          surveyVersionId: submission.surveyVersionId,
          answerCount: submission.answers.filter((answer) =>
            applicability.applicableQuestionIds.has(answer.questionId),
          ).length,
          applicability: {
            applicableCount: applicability.applicableQuestionIds.size,
            excludedCount: applicability.excludedQuestionIds.size,
          },
          evaluationResult: {
            id: result.id,
            generalScore: result.generalScore,
            algorithmVersion: result.algorithmVersion,
          },
          originalRespondent: submission.originalRespondentSnapshot,
        },
      );
    });
    return this.workspace(campaignId, actor);
  }

  private async getSubmission(
    manager: EntityManager,
    campaignId: string,
    schoolId: string,
    lock: boolean,
  ) {
    if (lock) {
      const locked = await manager.findOne(SurveySubmission, {
        where: { campaignId, schoolId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked)
        throw new NotFoundException(
          'Todavía no existe una presentación para esta etapa.',
        );
    }
    const submission = await manager.findOne(SurveySubmission, {
      where: { campaignId, schoolId },
      relations: {
        campaign: { surveyVersion: { survey: true } },
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
    if (!submission)
      throw new NotFoundException(
        'Todavía no existe una presentación para esta etapa.',
      );
    // Estas colecciones no comparten una rama relacional. Incluirlas en la
    // consulta anterior multiplica respuestas x decisiones x preguntas y
    // vuelve muy lenta la apertura del cuestionario.
    const [answers, applicabilityDecisions] = await Promise.all([
      manager.find(SurveyAnswer, {
        where: { submissionId: submission.id },
        relations: { option: true },
      }),
      manager.find(SubmissionQuestionApplicability, {
        where: { submissionId: submission.id },
      }),
    ]);
    submission.answers = answers ?? submission.answers ?? [];
    submission.applicabilityDecisions =
      applicabilityDecisions ?? submission.applicabilityDecisions ?? [];
    return submission;
  }

  /**
   * Carga respuestas y decisiones en dos consultas agrupadas. Evita el
   * producto cartesiano que produciría incluir ambas relaciones 1:N en el
   * mismo `find` al listar varios borradores históricos.
   */
  private async loadSubmissionCollections(submissions: SurveySubmission[]) {
    if (!submissions.length) return;
    const submissionIds = submissions.map(({ id }) => id);
    const [answers, applicabilityDecisions] = await Promise.all([
      this.dataSource.manager.find(SurveyAnswer, {
        where: { submissionId: In(submissionIds) },
      }),
      this.dataSource.manager.find(SubmissionQuestionApplicability, {
        where: { submissionId: In(submissionIds) },
      }),
    ]);
    const answersBySubmission = this.groupBySubmission(answers);
    const decisionsBySubmission = this.groupBySubmission(
      applicabilityDecisions,
    );
    submissions.forEach((submission) => {
      submission.answers = answersBySubmission.get(submission.id) ?? [];
      submission.applicabilityDecisions =
        decisionsBySubmission.get(submission.id) ?? [];
    });
  }

  private groupBySubmission<T extends { submissionId: string }>(rows: T[]) {
    const grouped = new Map<string, T[]>();
    rows.forEach((row) => {
      const current = grouped.get(row.submissionId);
      if (current) current.push(row);
      else grouped.set(row.submissionId, [row]);
    });
    return grouped;
  }

  /**
   * Lee sólo la identidad y la etapa para decidir si el workspace puede
   * mutar. Así los borradores históricos nunca adquieren un bloqueo de
   * escritura, mientras que un borrador operativo se vuelve a cargar bajo
   * `pessimistic_write` antes de refrescar su snapshot o aplicabilidad.
   */
  private async getSubmissionAccessState(
    manager: EntityManager,
    campaignId: string,
    schoolId: string,
  ) {
    const submission = await manager.findOne(SurveySubmission, {
      where: { campaignId, schoolId },
      relations: { campaign: true },
    });
    if (!submission)
      throw new NotFoundException(
        'Todavía no existe una presentación para esta etapa.',
      );
    return submission;
  }

  private async getVersion(manager: EntityManager, versionId: string) {
    const version = await manager.findOne(SurveyVersion, {
      where: { id: versionId },
      relations: {
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
      order: {
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
    });
    if (
      !version ||
      !isHistoricallyAvailableSurveyVersion(version.status, version.publishedAt)
    )
      throw new ConflictException(
        'La versión asociada a la presentación no está disponible.',
      );
    return version;
  }

  private validateAnswers(
    version: SurveyVersion,
    dto: SaveSubmissionDraftDto,
    applicability: SurveyApplicabilityResult,
  ) {
    const questions = this.questions(version);
    const questionsById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const seen = new Set<string>();
    return dto.answers.flatMap((answer) => {
      if (seen.has(answer.questionId))
        throw new BadRequestException(
          'No se puede enviar dos respuestas para la misma pregunta.',
        );
      seen.add(answer.questionId);
      const question = questionsById.get(answer.questionId);
      if (!question)
        throw new BadRequestException(
          'Una de las preguntas no pertenece a la versión de la etapa.',
        );
      if (this.isEmptyAnswer(answer.optionId, answer.value)) return [];
      if (!applicability.applicableQuestionIds.has(question.id))
        throw new BadRequestException(
          applicability.incompleteQuestionIds.has(question.id)
            ? `No se puede responder ${question.code} hasta completar los datos escolares requeridos.`
            : `La pregunta ${question.code} no es aplicable a este establecimiento.`,
        );
      return [this.validateAnswer(question, answer.optionId, answer.value)];
    });
  }

  private validateAnswer(
    question: SurveyQuestion,
    optionId: string | null | undefined,
    value: SurveyAnswerValue | undefined,
  ) {
    if (question.type === SurveyQuestionType.SingleChoice) {
      const option = question.options.find(
        (candidate) => candidate.id === optionId,
      );
      if (!option)
        throw new BadRequestException(
          `Seleccioná una opción válida para la pregunta ${question.code}.`,
        );
      return {
        questionId: question.id,
        optionId: option.id,
        value: null,
      };
    }
    if (question.type === SurveyQuestionType.MultipleChoice)
      throw new BadRequestException(
        'El cuestionario institucional no admite selección múltiple.',
      );
    if (optionId)
      throw new BadRequestException(
        `La pregunta ${question.code} no admite opciones.`,
      );
    if (question.type === SurveyQuestionType.Boolean) {
      if (value !== 'yes' && value !== 'no')
        throw new BadRequestException(
          `Indicá Sí o No para la pregunta ${question.code}.`,
        );
    } else if (question.type === SurveyQuestionType.Number) {
      if (typeof value !== 'number' || !Number.isFinite(value))
        throw new BadRequestException(
          `Ingresá un número válido para la pregunta ${question.code}.`,
        );
      this.validateNumber(question.code, value, question.validation);
    } else {
      if (typeof value !== 'string')
        throw new BadRequestException(
          `Ingresá un valor válido para la pregunta ${question.code}.`,
        );
      this.validateText(question, value);
    }
    return { questionId: question.id, optionId: null, value: value ?? null };
  }

  private validateNumber(
    code: string,
    value: number,
    validation: SurveyQuestionValidation,
  ) {
    if (validation.min !== undefined && value < validation.min)
      throw new BadRequestException(
        `El valor de ${code} no puede ser menor que ${validation.min}.`,
      );
    if (validation.max !== undefined && value > validation.max)
      throw new BadRequestException(
        `El valor de ${code} no puede ser mayor que ${validation.max}.`,
      );
  }

  private validateText(question: SurveyQuestion, value: string) {
    if (
      question.type === SurveyQuestionType.Date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(value)
    )
      throw new BadRequestException(
        `Ingresá una fecha válida para la pregunta ${question.code}.`,
      );
    if (
      question.validation.minLength !== undefined &&
      value.length < question.validation.minLength
    )
      throw new BadRequestException(
        `La respuesta ${question.code} es demasiado corta.`,
      );
    if (
      question.validation.maxLength !== undefined &&
      value.length > question.validation.maxLength
    )
      throw new BadRequestException(
        `La respuesta ${question.code} es demasiado larga.`,
      );
  }

  private serializeWorkspace(
    submission: SurveySubmission,
    applicability: SurveyApplicabilityResult,
    editable: boolean,
    blockingReason: string | null,
  ) {
    const questions = this.questions(submission.surveyVersion).filter(
      (question) => applicability.applicableQuestionIds.has(question.id),
    );
    const required = questions.filter((question) => question.required);
    const answeredIds = new Set(
      submission.answers
        .filter((answer) =>
          applicability.applicableQuestionIds.has(answer.questionId),
        )
        .map((answer) => answer.questionId),
    );
    const answerValues = Object.fromEntries(
      submission.answers
        .filter((answer) =>
          applicability.applicableQuestionIds.has(answer.questionId),
        )
        .map((answer) => [answer.questionId, answer.optionId ?? answer.value]),
    );
    return {
      campaign: this.campaignSummary(submission.campaign),
      submission: {
        id: submission.id,
        status: submission.status,
        startedAt: submission.startedAt,
        lastSavedAt: submission.lastSavedAt,
        submittedAt: submission.submittedAt,
        originalRespondent: submission.originalRespondentSnapshot,
        schoolRectificationId: submission.schoolRectificationId,
        schoolProfileSnapshot: submission.schoolProfileSnapshot,
        editable,
        blockingReason,
        canSubmit: editable && applicability.status === 'ready',
        progress: {
          answered: answeredIds.size,
          total: questions.length,
          percentage: questions.length
            ? Math.round((answeredIds.size / questions.length) * 100)
            : 0,
          requiredAnswered: required.filter((question) =>
            answeredIds.has(question.id),
          ).length,
          requiredTotal: required.length,
        },
      },
      applicability: {
        status: applicability.status,
        source: applicability.source,
        evaluatedAt: applicability.evaluatedAt,
        missingFields: applicability.missingFields,
        excluded: applicability.decisions
          .filter(({ status }) => status === 'excluded')
          .map((decision) => ({
            questionId: decision.questionId,
            questionCode: decision.questionCode,
            appliedRuleId: decision.appliedRuleId,
            reasonCode: decision.reasonCode,
            reasonDescription: decision.reasonDescription,
          })),
        incomplete: applicability.decisions
          .filter(({ status }) => status === 'incomplete')
          .map((decision) => ({
            questionId: decision.questionId,
            questionCode: decision.questionCode,
            reasonCode: decision.reasonCode,
            reasonDescription: decision.reasonDescription,
            missingFeatures: decision.missingFeatures,
          })),
      },
      answers: answerValues,
      survey: this.serializeSurvey(
        submission.surveyVersion,
        applicability.applicableQuestionIds,
      ),
    };
  }

  private serializeSurvey(
    version: SurveyVersion,
    applicableQuestionIds: Set<string>,
  ) {
    return {
      code: version.survey.code,
      name: version.survey.name,
      description: version.survey.description,
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        title: version.title,
        instructions: version.instructions,
        publishedAt: version.publishedAt,
        dimensions: version.dimensions.flatMap((dimension) => {
          const sections = dimension.sections.flatMap((section) => {
            const questions = section.questions
              .filter((question) => applicableQuestionIds.has(question.id))
              .map((question) => ({
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
                  score: null,
                  order: option.order,
                })),
              }));
            return questions.length
              ? [
                  {
                    id: section.id,
                    code: section.code,
                    title: section.title,
                    description: section.description,
                    order: section.order,
                    questions,
                  },
                ]
              : [];
          });
          return sections.length
            ? [
                {
                  id: dimension.id,
                  code: dimension.code,
                  title: dimension.title,
                  description: dimension.description,
                  order: dimension.order,
                  sections,
                },
              ]
            : [];
        }),
      },
    };
  }

  /**
   * Un borrador puede adoptar una rectificación posterior para resolver datos
   * faltantes. La actualización queda auditada y nunca se ejecuta sobre una
   * presentación enviada, cuya identidad continúa protegida por base de datos.
   */
  private async refreshDraftRectification(
    manager: EntityManager,
    submission: SurveySubmission,
    rectification: {
      id: string | null;
      isEvaluationReady: boolean;
      snapshot: SurveySubmission['schoolProfileSnapshot'];
    },
    actorUserId: string,
  ) {
    if (
      submission.status !== SubmissionStatus.Draft ||
      !rectification.isEvaluationReady ||
      !rectification.id ||
      !rectification.snapshot ||
      (submission.schoolRectificationId === rectification.id &&
        submission.schoolProfileSnapshot)
    )
      return;
    const previousRectificationId = submission.schoolRectificationId;
    submission.schoolRectificationId = rectification.id;
    submission.schoolProfileSnapshot = structuredClone(rectification.snapshot);
    await manager.update(SurveySubmission, submission.id, {
      schoolRectificationId: submission.schoolRectificationId,
      schoolProfileSnapshot: submission.schoolProfileSnapshot,
    });
    await this.audit(
      manager,
      actorUserId,
      'SUBMISSION_RECTIFICATION_REFRESHED',
      submission.id,
      {
        previousRectificationId,
        schoolRectificationId: rectification.id,
      },
    );
  }

  /**
   * Resuelve la aplicabilidad usando siempre el snapshot vinculado. Los
   * borradores se recalculan y reemplazan sus decisiones; los envíos leen las
   * decisiones congeladas. Un envío legado sin decisiones sólo puede
   * reconstruirse a partir de su snapshot histórico, nunca de la ficha actual.
   */
  private async resolveApplicability(
    manager: EntityManager,
    submission: SurveySubmission,
    version = submission.surveyVersion,
    options: { readOnly?: boolean } = {},
  ) {
    if (
      !version ||
      version.id !== submission.surveyVersionId ||
      !isHistoricallyAvailableSurveyVersion(version.status, version.publishedAt)
    )
      throw new ConflictException(
        'La versión asociada a la presentación no está disponible.',
      );
    const readOnly = options.readOnly ?? false;
    const stored = submission.applicabilityDecisions ?? [];
    if (
      (submission.status === SubmissionStatus.Submitted || readOnly) &&
      stored.length
    )
      return this.applicabilityFromStored(version, stored);

    const evaluated = this.surveyApplicability.evaluate(
      version,
      submission.schoolProfileSnapshot,
    );
    if (
      submission.status === SubmissionStatus.Draft &&
      !readOnly &&
      !this.sameApplicabilityDecisions(stored, evaluated.decisions)
    )
      await this.persistApplicability(manager, submission, evaluated);
    return {
      ...evaluated,
      source:
        submission.status === SubmissionStatus.Submitted || readOnly
          ? ('reconstructed' as const)
          : evaluated.source,
    };
  }

  /** Evita reescribir decisiones idénticas en cada apertura o autoguardado. */
  private sameApplicabilityDecisions(
    stored: SubmissionQuestionApplicability[],
    evaluated: QuestionApplicabilityResolution[],
  ) {
    if (stored.length !== evaluated.length) return false;
    const storedByQuestion = new Map(
      stored.map((decision) => [decision.questionId, decision]),
    );
    return evaluated.every((decision) => {
      const previous = storedByQuestion.get(decision.questionId);
      return (
        previous?.surveyVersionId === decision.surveyVersionId &&
        previous.status === decision.status &&
        previous.appliedRuleId === decision.appliedRuleId &&
        previous.reasonCode === decision.reasonCode &&
        previous.reasonDescription === decision.reasonDescription &&
        isDeepStrictEqual(previous.missingFeatures, decision.missingFeatures) &&
        isDeepStrictEqual(
          previous.relevantSchoolFacts,
          decision.relevantSchoolFacts,
        )
      );
    });
  }

  private applicabilityFromStored(
    version: SurveyVersion,
    stored: SubmissionQuestionApplicability[],
  ) {
    const questionCodes = new Map(
      this.questions(version).map((question) => [question.id, question.code]),
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
        missingFeatures: decision.missingFeatures,
        relevantSchoolFacts:
          decision.relevantSchoolFacts as QuestionApplicabilityResolution['relevantSchoolFacts'],
        evaluatedAt: decision.evaluatedAt,
      }),
    );
    return this.surveyApplicability.result(version.id, decisions, 'persisted');
  }

  private async persistApplicability(
    manager: EntityManager,
    submission: SurveySubmission,
    applicability: SurveyApplicabilityResult,
  ) {
    await manager.delete(SubmissionQuestionApplicability, {
      submissionId: submission.id,
    });
    const entities = applicability.decisions.map((decision) =>
      manager.create(SubmissionQuestionApplicability, {
        submissionId: submission.id,
        questionId: decision.questionId,
        surveyVersionId: decision.surveyVersionId,
        appliedRuleId: decision.appliedRuleId,
        status: decision.status,
        reasonCode: decision.reasonCode,
        reasonDescription: decision.reasonDescription,
        missingFeatures: decision.missingFeatures,
        relevantSchoolFacts: decision.relevantSchoolFacts,
        evaluatedAt: decision.evaluatedAt,
      }),
    );
    if (entities.length)
      await manager.save(SubmissionQuestionApplicability, entities);
    submission.applicabilityDecisions = entities;
  }

  private assertApplicabilityComplete(
    applicability: SurveyApplicabilityResult,
  ) {
    if (applicability.status === 'ready') return;
    const fields = applicability.missingFields
      .map(({ label }) => label)
      .join(', ');
    throw new BadRequestException(
      `No se puede enviar la presentación porque faltan datos en la ficha escolar: ${fields}. Rectificá la ficha y volvé a intentar.`,
    );
  }

  private async questionCounts(versionIds: string[]) {
    const counts = new Map<string, number>();
    if (!versionIds.length) return counts;
    const rows = await this.dataSource
      .getRepository(SurveyQuestion)
      .createQueryBuilder('question')
      .innerJoin('question.section', 'section')
      .innerJoin('section.dimension', 'dimension')
      .select('dimension.versionId', 'versionId')
      .addSelect('COUNT(question.id)', 'count')
      .where('dimension.versionId IN (:...versionIds)', { versionIds })
      .groupBy('dimension.versionId')
      .getRawMany<{ versionId: string; count: string }>();
    rows.forEach((row) => counts.set(row.versionId, Number(row.count)));
    return counts;
  }

  private questions(version: SurveyVersion) {
    return version.dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) => section.questions),
    );
  }

  private submissionSummary(
    submission: SurveySubmission,
    totalQuestions: number,
  ) {
    const storedApplicableIds = new Set(
      (submission.applicabilityDecisions ?? [])
        .filter(({ status }) => status === 'applicable')
        .map(({ questionId }) => questionId),
    );
    const hasResolution = (submission.applicabilityDecisions ?? []).length > 0;
    const total = hasResolution ? storedApplicableIds.size : totalQuestions;
    const answered = hasResolution
      ? submission.answers.filter(({ questionId }) =>
          storedApplicableIds.has(questionId),
        ).length
      : submission.answers.length;
    return {
      id: submission.id,
      status: submission.status,
      startedAt: submission.startedAt,
      lastSavedAt: submission.lastSavedAt,
      submittedAt: submission.submittedAt,
      progress: {
        answered,
        total,
        percentage: total ? Math.round((answered / total) * 100) : 0,
      },
    };
  }

  private campaignSummary(campaign: SurveySubmission['campaign']) {
    return {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      type: campaign.type,
      status: campaign.status,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      surveyVersion: campaign.surveyVersion
        ? {
            id: campaign.surveyVersion.id,
            versionNumber: campaign.surveyVersion.versionNumber,
            title: campaign.surveyVersion.title,
            survey: {
              code: campaign.surveyVersion.survey.code,
              name: campaign.surveyVersion.survey.name,
            },
          }
        : undefined,
    };
  }

  private blockingReason(
    schoolActive: boolean,
    isConfirmed: boolean,
    isEvaluationReady: boolean,
  ) {
    if (!schoolActive)
      return 'El establecimiento está inactivo y no puede iniciar evaluaciones.';
    if (!isConfirmed)
      return 'Debés confirmar la ficha institucional anual antes de comenzar.';
    if (!isEvaluationReady)
      return 'La ficha anual está confirmada, pero requiere actualización antes de comenzar.';
    return null;
  }

  private isCampaignOpen(campaign: SurveySubmission['campaign']) {
    const now = Date.now();
    return (
      campaign.status === CampaignStatus.Active &&
      campaign.startsAt.getTime() <= now &&
      campaign.endsAt.getTime() >= now
    );
  }

  /**
   * Un borrador histórico existe por la propia presentación, aunque su
   * asignación haya sido retirada. No se consideran etapas futuras ni
   * etapas abiertas: esas continúan en el flujo operativo habitual.
   */
  private isExpiredDraft(submission: SurveySubmission, now: number) {
    if (
      submission.status !== SubmissionStatus.Draft ||
      !submission.campaign ||
      submission.campaign.startsAt.getTime() > now
    )
      return false;
    return (
      submission.campaign.endsAt.getTime() < now ||
      submission.campaign.status === CampaignStatus.Closed ||
      submission.campaign.status === CampaignStatus.Archived
    );
  }

  private isEmptyAnswer(
    optionId: string | null | undefined,
    value: SurveyAnswerValue | undefined,
  ) {
    return (
      !optionId &&
      (value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === ''))
    );
  }

  private assertDraft(submission: SurveySubmission) {
    if (submission.status !== SubmissionStatus.Draft)
      throw new ConflictException(
        'La presentación ya fue enviada y no admite modificaciones.',
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
      entityType: 'SurveySubmission',
      entityId,
      changes,
    });
  }

  private isUniqueViolation(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}

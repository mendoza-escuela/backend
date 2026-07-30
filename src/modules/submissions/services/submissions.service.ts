import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { CampaignsService } from '../../campaigns/services/campaigns.service';
import { SchoolsService } from '../../schools/services/schools.service';
import { SurveyQuestionType } from '../../surveys/entities/survey-question-type.enum';
import {
  SurveyQuestion,
  SurveyQuestionValidation,
} from '../../surveys/entities/survey-question.entity';
import { SurveyVersionStatus } from '../../surveys/entities/survey-version-status.enum';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { SaveSubmissionDraftDto } from '../dto/save-submission-draft.dto';
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
    private readonly schoolsService: SchoolsService,
  ) {}

  async availableCampaigns(actor: AuthenticatedUser) {
    const [{ school, rectification }, campaigns] = await Promise.all([
      this.schoolsService.evaluationContextForUser(actor.id),
      this.campaignsService.operationalCampaigns(),
    ]);
    const campaignIds = campaigns.map((campaign) => campaign.id);
    const submissions = campaignIds.length
      ? await this.dataSource.getRepository(SurveySubmission).find({
          where: {
            schoolId: school.id,
            campaignId: In(campaignIds),
          },
          relations: { answers: true },
        })
      : [];
    const submissionsByCampaign = new Map(
      submissions.map((submission) => [submission.campaignId, submission]),
    );
    const questionCounts = await this.questionCounts(
      campaigns.map((campaign) => campaign.surveyVersionId),
    );

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
          canStart: school.isActive && rectification.isRectified,
          blockingReason: this.blockingReason(
            school.isActive,
            rectification.isRectified,
          ),
          submission: submission
            ? this.submissionSummary(submission, totalQuestions)
            : null,
        };
      }),
    };
  }

  async startOrGet(campaignId: string, actor: AuthenticatedUser) {
    let submissionId: string | null = null;
    try {
      submissionId = await this.dataSource.transaction(async (manager) => {
        const { school, rectification } =
          await this.schoolsService.evaluationContextForUser(actor.id, manager);
        const campaign = await this.campaignsService.assertOperational(
          campaignId,
          manager,
        );
        const existing = await manager.findOne(SurveySubmission, {
          where: { campaignId, schoolId: school.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing) return existing.id;
        if (!school.isActive)
          throw new ConflictException(
            'El establecimiento está inactivo y no puede iniciar una evaluación.',
          );
        if (!rectification.isRectified)
          throw new ConflictException(
            `Antes de comenzar debés rectificar la ficha escolar para ${rectification.periodYear}.`,
          );

        const submission = await manager.save(
          SurveySubmission,
          manager.create(SurveySubmission, {
            campaignId: campaign.id,
            schoolId: school.id,
            surveyVersionId: campaign.surveyVersionId,
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
    const { school } = await this.schoolsService.evaluationContextForUser(
      actor.id,
    );
    const submission = await this.getSubmission(
      this.dataSource.manager,
      campaignId,
      school.id,
      false,
    );
    const campaignOpen = this.isCampaignOpen(submission.campaign);
    return this.serializeWorkspace(
      submission,
      school.isActive &&
        campaignOpen &&
        submission.status === SubmissionStatus.Draft,
      !school.isActive
        ? 'El establecimiento está inactivo.'
        : !campaignOpen
          ? 'La campaña ya no se encuentra abierta.'
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
      const { school } = await this.schoolsService.evaluationContextForUser(
        actor.id,
        manager,
      );
      await this.schoolsService.assertActiveForEvaluation(school.id, manager);
      await this.campaignsService.assertOperational(campaignId, manager);
      const submission = await this.getSubmission(
        manager,
        campaignId,
        school.id,
        true,
      );
      this.assertDraft(submission);
      const version = await this.getVersion(
        manager,
        submission.surveyVersionId,
      );
      const answers = this.validateAnswers(version, dto);

      await manager.delete(SurveyAnswer, { submissionId: submission.id });
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
      const { school } = await this.schoolsService.evaluationContextForUser(
        actor.id,
        manager,
      );
      await this.schoolsService.assertActiveForEvaluation(school.id, manager);
      await this.campaignsService.assertOperational(campaignId, manager);
      const submission = await this.getSubmission(
        manager,
        campaignId,
        school.id,
        true,
      );
      this.assertDraft(submission);
      const version = await this.getVersion(
        manager,
        submission.surveyVersionId,
      );
      const missing = this.requiredQuestions(version).filter(
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
      await this.audit(
        manager,
        actor.id,
        'SUBMISSION_SUBMITTED',
        submission.id,
        {
          campaignId,
          schoolId: school.id,
          surveyVersionId: submission.surveyVersionId,
          answerCount: submission.answers.length,
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
          'Todavía no existe una presentación para esta campaña.',
        );
    }
    const submission = await manager.findOne(SurveySubmission, {
      where: { campaignId, schoolId },
      relations: {
        campaign: { surveyVersion: { survey: true } },
        answers: { option: true },
        surveyVersion: {
          survey: true,
          dimensions: {
            sections: {
              questions: { options: true },
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
              },
            },
          },
        },
      },
    });
    if (!submission)
      throw new NotFoundException(
        'Todavía no existe una presentación para esta campaña.',
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
            questions: { options: true },
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
            },
          },
        },
      },
    });
    if (!version || version.status !== SurveyVersionStatus.Published)
      throw new ConflictException(
        'La versión asociada a la presentación no está disponible.',
      );
    return version;
  }

  private validateAnswers(version: SurveyVersion, dto: SaveSubmissionDraftDto) {
    const questions = this.questions(version);
    const questionsById = new Map(
      questions.map((question) => [question.id, question]),
    );
    const seen = new Set<string>();
    return dto.answers
      .filter((answer) => !this.isEmptyAnswer(answer.optionId, answer.value))
      .map((answer) => {
        if (seen.has(answer.questionId))
          throw new BadRequestException(
            'No se puede enviar dos respuestas para la misma pregunta.',
          );
        seen.add(answer.questionId);
        const question = questionsById.get(answer.questionId);
        if (!question)
          throw new BadRequestException(
            'Una de las preguntas no pertenece a la versión de la campaña.',
          );
        return this.validateAnswer(question, answer.optionId, answer.value);
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
    editable: boolean,
    blockingReason: string | null,
  ) {
    const questions = this.questions(submission.surveyVersion);
    const required = questions.filter((question) => question.required);
    const answeredIds = new Set(
      submission.answers.map((answer) => answer.questionId),
    );
    const answerValues = Object.fromEntries(
      submission.answers.map((answer) => [
        answer.questionId,
        answer.optionId ?? answer.value,
      ]),
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
        editable,
        blockingReason,
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
      answers: answerValues,
      survey: this.serializeSurvey(submission.surveyVersion),
    };
  }

  private serializeSurvey(version: SurveyVersion) {
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
                score: null,
                order: option.order,
              })),
            })),
          })),
        })),
      },
    };
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

  private requiredQuestions(version: SurveyVersion) {
    return this.questions(version).filter((question) => question.required);
  }

  private submissionSummary(
    submission: SurveySubmission,
    totalQuestions: number,
  ) {
    const answered = submission.answers.length;
    return {
      id: submission.id,
      status: submission.status,
      startedAt: submission.startedAt,
      lastSavedAt: submission.lastSavedAt,
      submittedAt: submission.submittedAt,
      progress: {
        answered,
        total: totalQuestions,
        percentage: totalQuestions
          ? Math.round((answered / totalQuestions) * 100)
          : 0,
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

  private blockingReason(schoolActive: boolean, rectified: boolean) {
    if (!schoolActive)
      return 'El establecimiento está inactivo y no puede iniciar evaluaciones.';
    if (!rectified)
      return 'Debés completar la rectificación anual antes de comenzar.';
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { User } from '../../users/entities/user.entity';
import { EvaluationResult } from '../entities/evaluation-result.entity';
import type { EvaluationDimensionSnapshot } from '../evaluation-snapshot.type';
import type {
  AdminSchoolPersistedResultDto,
  AdminSchoolResultDetailDto,
  AdminSchoolResultHistoryEntryDto,
} from '../dto/admin-school-result-detail.dto';

@Injectable()
export class AdminSchoolResultDetailService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Recupera el detalle histórico persistido de una escuela en una campaña.
   * Nunca vuelve a ejecutar el motor ni mezcla respuestas con la ficha actual.
   */
  async get(
    campaignId: string,
    schoolId: string,
  ): Promise<AdminSchoolResultDetailDto> {
    const [campaign, school] = await Promise.all([
      this.dataSource.getRepository(Campaign).findOneBy({ id: campaignId }),
      this.dataSource.getRepository(School).findOneBy({ id: schoolId }),
    ]);
    if (!campaign) throw new NotFoundException('La campaña no existe.');
    if (!school) throw new NotFoundException('La escuela no existe.');

    const submission = await this.dataSource
      .getRepository(SurveySubmission)
      .findOne({ where: { campaignId, schoolId } });
    const cutoff =
      campaign.closedAt && campaign.closedAt < campaign.endsAt
        ? campaign.closedAt
        : campaign.endsAt;
    if (!submission && school.createdAt > cutoff) {
      throw new NotFoundException(
        'La escuela no estaba incluida en el universo de esta campaña.',
      );
    }

    const evaluation = submission
      ? await this.dataSource.getRepository(EvaluationResult).findOne({
          where: { submissionId: submission.id },
          relations: { calculatedBy: true },
        })
      : null;
    const respondentId =
      submission?.originalRespondentSnapshot?.id ??
      submission?.originalRespondentId ??
      null;
    const respondent = respondentId
      ? await this.dataSource
          .getRepository(User)
          .findOneBy({ id: respondentId })
      : null;

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt.toISOString(),
      },
      school: {
        id: school.id,
        cue: school.cue,
        name: school.name,
        schoolNumber: school.schoolNumber,
        department: school.department,
        locality: school.locality,
        managementType: school.managementType,
        scope: school.scope,
        educationLevel: school.educationLevel,
        isActive: school.isActive,
      },
      participationStatus: !submission
        ? 'not_started'
        : submission.status === SubmissionStatus.Submitted
          ? 'submitted'
          : 'draft',
      submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            startedAt: submission.startedAt?.toISOString() ?? null,
            lastSavedAt: submission.lastSavedAt?.toISOString() ?? null,
            submittedAt: submission.submittedAt?.toISOString() ?? null,
            originalRespondent: {
              id: respondentId,
              firstName:
                submission.originalRespondentSnapshot?.firstName ??
                respondent?.firstName ??
                '',
              lastName:
                submission.originalRespondentSnapshot?.lastName ??
                respondent?.lastName ??
                '',
              email:
                submission.originalRespondentSnapshot?.email ??
                respondent?.email ??
                '',
              isActive: respondent?.isActive ?? null,
            },
          }
        : null,
      historicalSchoolProfile:
        evaluation?.snapshot?.school ??
        submission?.schoolProfileSnapshot ??
        null,
      result: evaluation ? this.serializeResult(evaluation) : null,
      history: this.history(submission, evaluation),
      dataQuality: {
        historicalProfileAvailable: Boolean(
          evaluation?.snapshot?.school ?? submission?.schoolProfileSnapshot,
        ),
        resultSnapshotAvailable: Boolean(evaluation?.snapshot),
      },
    };
  }

  private serializeResult(
    evaluation: EvaluationResult,
  ): AdminSchoolPersistedResultDto {
    const snapshot = evaluation.snapshot;
    const dimensions = Array.isArray(snapshot?.survey?.dimensions)
      ? [...snapshot.survey.dimensions].sort((a, b) => a.order - b.order)
      : [];
    const questions = dimensions.flatMap((dimension) =>
      [...dimension.sections]
        .sort((a, b) => a.order - b.order)
        .flatMap((section) =>
          [...section.questions]
            .sort((a, b) => a.order - b.order)
            .map((question) => ({ dimension, section, question })),
        ),
    );
    return {
      id: evaluation.id,
      generalScore: this.number(snapshot?.result?.generalScore),
      numerator: this.number(snapshot?.result?.numerator),
      denominator: snapshot?.result?.denominator ?? null,
      stars: {
        base: snapshot?.result?.stars?.baseValue ?? evaluation.baseStars,
        final: snapshot?.result?.stars?.value ?? evaluation.stars,
        blockingReasons:
          snapshot?.result?.stars?.blockingReasons ??
          evaluation.starBlockingReasons ??
          [],
        configurationVersion:
          snapshot?.result?.stars?.configuration?.versionCode ??
          evaluation.evaluationConfigurationVersion,
      },
      alerts:
        snapshot?.result?.stars?.alerts ?? evaluation.evaluationAlerts ?? [],
      dimensions: dimensions.map((dimension) => this.dimension(dimension)),
      answers: questions.flatMap(({ dimension, section, question }) =>
        question.applicability?.status === 'applicable' && question.answer
          ? [
              {
                id: question.id,
                code: question.code,
                prompt: question.prompt,
                required: question.required,
                order: question.order,
                dimension: { code: dimension.code, title: dimension.title },
                section: { code: section.code, title: section.title },
                applicability: question.applicability.status,
                answer: {
                  value: question.answer.value,
                  optionLabel: question.answer.selectedOption?.label ?? null,
                  scoreUsed: this.number(question.scoreUsed),
                },
              },
            ]
          : [],
      ),
      excludedQuestions: questions.flatMap(
        ({ dimension, section, question }) =>
          question.applicability?.status === 'excluded'
            ? [
                {
                  id: question.id,
                  code: question.code,
                  prompt: question.prompt,
                  required: question.required,
                  order: question.order,
                  dimension: { code: dimension.code, title: dimension.title },
                  section: { code: section.code, title: section.title },
                  exclusion: {
                    reasonCode: question.applicability.reasonCode,
                    reason: question.applicability.reasonDescription,
                    relevantSchoolFacts:
                      question.applicability.relevantSchoolFacts ?? {},
                    rules: question.rules ?? [],
                  },
                },
              ]
            : [],
      ),
      survey: snapshot?.survey
        ? {
            id: snapshot.survey.id,
            code: snapshot.survey.code,
            name: snapshot.survey.name,
            version: snapshot.survey.version,
          }
        : null,
      calculation: {
        calculatedAt:
          snapshot?.algorithm?.calculatedAt ??
          evaluation.calculatedAt.toISOString(),
        algorithmVersion:
          snapshot?.algorithm?.version ?? evaluation.algorithmVersion,
        snapshotSchemaVersion:
          snapshot?.schemaVersion ?? evaluation.snapshotSchemaVersion,
        source: evaluation.calculationSource,
        calculatedBy: evaluation.calculatedBy
          ? {
              id: evaluation.calculatedBy.id,
              firstName: evaluation.calculatedBy.firstName,
              lastName: evaluation.calculatedBy.lastName,
            }
          : null,
      },
    };
  }

  private dimension(dimension: EvaluationDimensionSnapshot) {
    return {
      id: dimension.id,
      code: dimension.code,
      title: dimension.title,
      order: dimension.order,
      score: this.number(dimension.result?.score),
      available: dimension.result?.score !== null,
      isCritical: dimension.result?.criticality?.isCritical ?? false,
      criticalValue: this.number(dimension.result?.criticality?.value),
      criticalThreshold: this.number(dimension.result?.criticality?.threshold),
    };
  }

  private history(
    submission: SurveySubmission | null,
    evaluation: EvaluationResult | null,
  ): AdminSchoolResultHistoryEntryDto[] {
    if (!submission) return [];
    return [
      submission.startedAt && {
        type: 'started',
        label: 'Presentación iniciada',
        at: submission.startedAt.toISOString(),
      },
      submission.lastSavedAt && {
        type: 'saved',
        label: 'Último borrador guardado',
        at: submission.lastSavedAt.toISOString(),
      },
      submission.submittedAt && {
        type: 'submitted',
        label: 'Presentación enviada',
        at: submission.submittedAt.toISOString(),
      },
      evaluation && {
        type: 'calculated',
        label: 'Resultado calculado',
        at: evaluation.calculatedAt.toISOString(),
      },
    ].filter((entry): entry is AdminSchoolResultHistoryEntryDto =>
      Boolean(entry),
    );
  }

  private number(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

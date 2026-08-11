import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SubmissionQuestionApplicability } from '../../submissions/entities/submission-question-applicability.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { OFFICIAL_KIOSK_QUESTION_CODES } from '../../surveys/policies/official-survey-applicability.policy';
import { EvaluationResult } from '../entities/evaluation-result.entity';
import { EvaluationResultsService } from './evaluation-results.service';

type AffectedSubmissionRow = {
  submissionId: string;
  campaignId: string;
  schoolId: string;
  submittedAt: Date | string;
  questionCodes: string[];
  affectedQuestionCount: number | string;
  lastDecisionAt: Date | string;
  generalScore: string | null;
  generalNumerator: string | null;
  generalDenominator: number | string | null;
  calculatedAt: Date | string | null;
};

export type KioskApplicabilityAudit = {
  affectedSubmissionCount: number;
  affectedQuestionDecisionCount: number;
  fingerprint: string;
  submissions: Array<{
    submissionId: string;
    campaignId: string;
    schoolId: string;
    submittedAt: string;
    questionCodes: string[];
    affectedQuestionCount: number;
    previousResult: {
      generalScore: string | null;
      generalNumerator: string | null;
      generalDenominator: number | null;
      calculatedAt: string | null;
    };
  }>;
};

const CORRECTION_REASON =
  'Corrección auditada: la pregunta de kiosco no corresponde porque la ficha histórica indica que la escuela no posee kiosco.';

@Injectable()
export class KioskApplicabilityDataRepairService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly evaluationResults: EvaluationResultsService,
  ) {}

  /**
   * Sólo inspecciona presentaciones enviadas cuyo snapshot histórico declara
   * hasKiosk=false y conserva decisiones no excluidas para p021-p027.
   */
  async audit(campaignId?: string): Promise<KioskApplicabilityAudit> {
    return this.auditTargets(campaignId ?? null, null);
  }

  /**
   * Corrige exclusivamente el conjunto validado en la vista previa. La huella
   * evita aplicar una decisión sobre datos que cambiaron después de auditarse.
   */
  async repair(
    submissionIds: string[],
    previewFingerprint: string,
    confirm: boolean,
    actorUserId: string,
  ) {
    const uniqueSubmissionIds = [...new Set(submissionIds)].sort();
    if (!confirm) {
      throw new BadRequestException({
        code: 'DATA_REPAIR_CONFIRMATION_REQUIRED',
        message: 'La reparación histórica requiere confirmación explícita.',
      });
    }
    if (uniqueSubmissionIds.length !== submissionIds.length) {
      throw new BadRequestException({
        code: 'DATA_REPAIR_DUPLICATE_TARGET',
        message: 'La lista contiene presentaciones repetidas.',
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const locked = await manager.find(SurveySubmission, {
        where: { id: In(uniqueSubmissionIds) },
        select: { id: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked.length !== uniqueSubmissionIds.length) {
        throw new NotFoundException(
          'Una o más presentaciones seleccionadas ya no existen.',
        );
      }
      const preview = await this.auditTargets(
        null,
        uniqueSubmissionIds,
        manager,
      );
      if (
        preview.affectedSubmissionCount !== uniqueSubmissionIds.length ||
        preview.fingerprint !== previewFingerprint
      ) {
        throw new ConflictException({
          code: 'DATA_REPAIR_PREVIEW_STALE',
          message:
            'Los datos cambiaron o la selección no coincide con la auditoría. Generá una nueva vista previa.',
        });
      }

      await manager.query(
        `SELECT set_config('ops.allow_kiosk_applicability_repair', 'on', true)`,
      );

      const corrected: Array<
        Awaited<ReturnType<typeof this.repairSubmission>>
      > = [];
      for (const submissionId of uniqueSubmissionIds) {
        corrected.push(
          await this.repairSubmission(manager, submissionId, actorUserId),
        );
      }
      return {
        correctedSubmissionCount: corrected.length,
        correctedQuestionDecisionCount: corrected.reduce(
          (total, row) => total + row.correctedQuestionCount,
          0,
        ),
        submissions: corrected,
      };
    });
  }

  private async auditTargets(
    campaignId: string | null,
    submissionIds: string[] | null,
    queryExecutor:
      Pick<DataSource, 'query'> | Pick<EntityManager, 'query'> = this
      .dataSource,
  ): Promise<KioskApplicabilityAudit> {
    const rows = await queryExecutor.query<AffectedSubmissionRow[]>(
      `
        SELECT
          submission.id AS "submissionId",
          submission.campaign_id AS "campaignId",
          submission.school_id AS "schoolId",
          submission.submitted_at AS "submittedAt",
          ARRAY_AGG(LOWER(question.code) ORDER BY LOWER(question.code)) AS "questionCodes",
          COUNT(*)::integer AS "affectedQuestionCount",
          MAX(applicability.evaluated_at) AS "lastDecisionAt",
          result.general_score AS "generalScore",
          result.general_numerator AS "generalNumerator",
          result.general_denominator AS "generalDenominator",
          result.calculated_at AS "calculatedAt"
        FROM survey_submissions submission
        INNER JOIN submission_question_applicability applicability
          ON applicability.submission_id = submission.id
        INNER JOIN survey_questions question
          ON question.id = applicability.question_id
        LEFT JOIN evaluation_results result
          ON result.submission_id = submission.id
        WHERE submission.status = 'submitted'
          AND submission.school_profile_snapshot @> '{"hasKiosk": false}'::jsonb
          AND LOWER(question.code) = ANY($1::text[])
          AND applicability.status <> 'excluded'
          AND ($2::uuid IS NULL OR submission.campaign_id = $2::uuid)
          AND ($3::uuid[] IS NULL OR submission.id = ANY($3::uuid[]))
        GROUP BY
          submission.id,
          result.general_score,
          result.general_numerator,
          result.general_denominator,
          result.calculated_at
        ORDER BY submission.id ASC
      `,
      [OFFICIAL_KIOSK_QUESTION_CODES, campaignId, submissionIds],
    );

    const normalized = rows.map((row) => ({
      submissionId: row.submissionId,
      campaignId: row.campaignId,
      schoolId: row.schoolId,
      submittedAt: new Date(row.submittedAt).toISOString(),
      questionCodes: [...row.questionCodes],
      affectedQuestionCount: Number(row.affectedQuestionCount),
      previousResult: {
        generalScore: row.generalScore,
        generalNumerator: row.generalNumerator,
        generalDenominator:
          row.generalDenominator === null
            ? null
            : Number(row.generalDenominator),
        calculatedAt: row.calculatedAt
          ? new Date(row.calculatedAt).toISOString()
          : null,
      },
      fingerprintState: {
        lastDecisionAt: new Date(row.lastDecisionAt).toISOString(),
        calculatedAt: row.calculatedAt
          ? new Date(row.calculatedAt).toISOString()
          : null,
      },
    }));
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          normalized.map(
            ({ submissionId, questionCodes, fingerprintState }) => ({
              submissionId,
              questionCodes,
              ...fingerprintState,
            }),
          ),
        ),
      )
      .digest('hex');
    return {
      affectedSubmissionCount: normalized.length,
      affectedQuestionDecisionCount: normalized.reduce(
        (total, row) => total + row.affectedQuestionCount,
        0,
      ),
      fingerprint,
      submissions: normalized.map(({ fingerprintState, ...row }) => {
        void fingerprintState;
        return row;
      }),
    };
  }

  private async repairSubmission(
    manager: EntityManager,
    submissionId: string,
    actorUserId: string,
  ) {
    const submission = await manager.findOne(SurveySubmission, {
      where: { id: submissionId },
      relations: { applicabilityDecisions: { question: true } },
    });
    if (!submission) {
      throw new NotFoundException('La presentación indicada no existe.');
    }
    if (
      submission.status !== SubmissionStatus.Submitted ||
      submission.schoolProfileSnapshot?.hasKiosk !== false
    ) {
      throw new ConflictException({
        code: 'DATA_REPAIR_TARGET_NO_LONGER_APPLIES',
        message: 'La presentación ya no cumple las condiciones de reparación.',
      });
    }

    const kioskCodes = new Set<string>(OFFICIAL_KIOSK_QUESTION_CODES);
    const affected = submission.applicabilityDecisions.filter(
      (decision) =>
        kioskCodes.has(decision.question.code.trim().toLowerCase()) &&
        decision.status !== 'excluded',
    );
    if (!affected.length) {
      throw new ConflictException({
        code: 'DATA_REPAIR_TARGET_NO_LONGER_APPLIES',
        message: 'La presentación ya no posee decisiones afectadas.',
      });
    }

    const previousResult = await manager.findOne(EvaluationResult, {
      where: { submissionId },
      lock: { mode: 'pessimistic_write' },
    });
    const previousResultSnapshot = previousResult
      ? {
          generalScore: previousResult.generalScore,
          generalNumerator: previousResult.generalNumerator,
          generalDenominator: previousResult.generalDenominator,
          calculatedAt: previousResult.calculatedAt.toISOString(),
        }
      : null;
    const before = affected.map((decision) => ({
      questionId: decision.questionId,
      questionCode: decision.question.code,
      status: decision.status,
      reasonCode: decision.reasonCode,
      evaluatedAt: decision.evaluatedAt.toISOString(),
    }));
    const correctedAt = new Date();
    for (const decision of affected) {
      Object.assign(decision, {
        status: 'excluded' as const,
        appliedRuleId: null,
        reasonCode: 'DATA_CORRECTION_KIOSK_NOT_APPLICABLE' as const,
        reasonDescription: CORRECTION_REASON,
        missingFeatures: [],
        relevantSchoolFacts: { has_kiosk: false },
        evaluatedAt: correctedAt,
      });
    }
    await manager.save(SubmissionQuestionApplicability, affected);
    const recalculated =
      await this.evaluationResults.recalculateSubmissionWithManager(
        manager,
        submissionId,
        actorUserId,
        'system',
      );
    await manager.save(
      AuditLog,
      manager.create(AuditLog, {
        actorUserId,
        action: 'KIOSK_APPLICABILITY_DATA_REPAIRED',
        entityType: 'SurveySubmission',
        entityId: submissionId,
        changes: {
          reason: 'BUG-001/DATA-01',
          schoolProfileHasKiosk: false,
          beforeApplicability: before,
          afterApplicability: affected.map((decision) => ({
            questionId: decision.questionId,
            questionCode: decision.question.code,
            status: decision.status,
            reasonCode: decision.reasonCode,
            evaluatedAt: correctedAt.toISOString(),
          })),
          previousResult: previousResultSnapshot,
          recalculatedResult: {
            generalScore: recalculated.generalScore,
            generalNumerator: recalculated.generalNumerator,
            generalDenominator: recalculated.generalDenominator,
            calculatedAt: recalculated.calculatedAt.toISOString(),
          },
        },
      }),
    );
    return {
      submissionId,
      correctedQuestionCount: affected.length,
      generalScore: recalculated.generalScore,
      generalDenominator: recalculated.generalDenominator,
    };
  }
}

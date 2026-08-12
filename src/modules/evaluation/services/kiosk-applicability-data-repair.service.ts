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
import { EVALUATION_ALGORITHM_VERSION } from '../evaluation.constants';
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
  resultId: string | null;
  algorithmVersion: string | null;
  evaluationConfigurationId: string | null;
  evaluationConfigurationVersion: string | null;
  resolvedEvaluationConfigurationVersion: string | null;
};

export type KioskApplicabilityRepairBlocker =
  | 'EVALUATION_RECALCULATION_RESULT_REQUIRED'
  | 'EVALUATION_RECALCULATION_ALGORITHM_DRIFT'
  | 'EVALUATION_RECALCULATION_CONFIGURATION_REQUIRED'
  | 'EVALUATION_RECALCULATION_CONFIGURATION_DRIFT';

export type KioskApplicabilityAudit = {
  affectedSubmissionCount: number;
  affectedQuestionDecisionCount: number;
  repairable: boolean;
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
      algorithmVersion: string | null;
      evaluationConfigurationId: string | null;
      evaluationConfigurationVersion: string | null;
    };
    recalculationBlockers: KioskApplicabilityRepairBlocker[];
  }>;
};

const CORRECTION_REASON =
  'Corrección auditada: la pregunta de kiosco no corresponde porque la ficha histórica indica que la escuela no posee kiosco.';
const MAX_REPAIR_BATCH_SIZE = 500;

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
   * Genera la huella del lote exacto que luego se enviará a reparación.
   * El GET general se conserva para descubrimiento, pero su huella no debe
   * reutilizarse al reparar un subconjunto.
   */
  async preview(submissionIds: string[]): Promise<KioskApplicabilityAudit> {
    const normalizedSubmissionIds = this.normalizeSubmissionIds(submissionIds);
    const preview = await this.auditTargets(null, normalizedSubmissionIds);
    if (preview.affectedSubmissionCount !== normalizedSubmissionIds.length) {
      const affectedIds = new Set(
        preview.submissions.map(({ submissionId }) => submissionId),
      );
      throw new ConflictException({
        code: 'DATA_REPAIR_SELECTION_NOT_ELIGIBLE',
        message:
          'Una o más presentaciones no existen o ya no requieren esta reparación.',
        ineligibleSubmissionIds: normalizedSubmissionIds.filter(
          (submissionId) => !affectedIds.has(submissionId),
        ),
      });
    }
    return preview;
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
    if (!confirm) {
      throw new BadRequestException({
        code: 'DATA_REPAIR_CONFIRMATION_REQUIRED',
        message: 'La reparación histórica requiere confirmación explícita.',
      });
    }
    const uniqueSubmissionIds = this.normalizeSubmissionIds(submissionIds);

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
      this.assertRecalculationIsSafe(preview);

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
          result.calculated_at AS "calculatedAt",
          result.id AS "resultId",
          result.algorithm_version AS "algorithmVersion",
          result.evaluation_configuration_id AS "evaluationConfigurationId",
          result.evaluation_configuration_version AS "evaluationConfigurationVersion",
          historical_configuration.version_code AS "resolvedEvaluationConfigurationVersion"
        FROM survey_submissions submission
        INNER JOIN submission_question_applicability applicability
          ON applicability.submission_id = submission.id
        INNER JOIN survey_questions question
          ON question.id = applicability.question_id
        LEFT JOIN evaluation_results result
          ON result.submission_id = submission.id
        LEFT JOIN evaluation_configurations historical_configuration
          ON historical_configuration.id = result.evaluation_configuration_id
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
          result.calculated_at,
          result.id,
          result.algorithm_version,
          result.evaluation_configuration_id,
          result.evaluation_configuration_version,
          historical_configuration.version_code
        ORDER BY submission.id ASC
      `,
      [OFFICIAL_KIOSK_QUESTION_CODES, campaignId, submissionIds],
    );

    const normalized = rows.map((row) => {
      const recalculationBlockers = this.recalculationBlockers(row);
      return {
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
          algorithmVersion: row.algorithmVersion,
          evaluationConfigurationId: row.evaluationConfigurationId,
          evaluationConfigurationVersion: row.evaluationConfigurationVersion,
        },
        recalculationBlockers,
        fingerprintState: {
          lastDecisionAt: new Date(row.lastDecisionAt).toISOString(),
          calculatedAt: row.calculatedAt
            ? new Date(row.calculatedAt).toISOString()
            : null,
          resultId: row.resultId,
          algorithmVersion: row.algorithmVersion,
          evaluationConfigurationId: row.evaluationConfigurationId,
          evaluationConfigurationVersion: row.evaluationConfigurationVersion,
          resolvedEvaluationConfigurationVersion:
            row.resolvedEvaluationConfigurationVersion,
        },
      };
    });
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
      repairable: normalized.every(
        ({ recalculationBlockers }) => !recalculationBlockers.length,
      ),
      fingerprint,
      submissions: normalized.map(({ fingerprintState, ...row }) => {
        void fingerprintState;
        return row;
      }),
    };
  }

  private normalizeSubmissionIds(submissionIds: string[]): string[] {
    if (
      submissionIds.length < 1 ||
      submissionIds.length > MAX_REPAIR_BATCH_SIZE
    ) {
      throw new BadRequestException({
        code: 'DATA_REPAIR_TARGET_LIMIT',
        message: `La reparación requiere entre 1 y ${MAX_REPAIR_BATCH_SIZE} presentaciones.`,
      });
    }
    const uniqueSubmissionIds = [...new Set(submissionIds)].sort();
    if (uniqueSubmissionIds.length !== submissionIds.length) {
      throw new BadRequestException({
        code: 'DATA_REPAIR_DUPLICATE_TARGET',
        message: 'La lista contiene presentaciones repetidas.',
      });
    }
    return uniqueSubmissionIds;
  }

  private recalculationBlockers(
    row: AffectedSubmissionRow,
  ): KioskApplicabilityRepairBlocker[] {
    if (!row.resultId) return ['EVALUATION_RECALCULATION_RESULT_REQUIRED'];

    const blockers: KioskApplicabilityRepairBlocker[] = [];
    if (row.algorithmVersion !== EVALUATION_ALGORITHM_VERSION) {
      blockers.push('EVALUATION_RECALCULATION_ALGORITHM_DRIFT');
    }
    if (
      !row.evaluationConfigurationId ||
      !row.resolvedEvaluationConfigurationVersion
    ) {
      blockers.push('EVALUATION_RECALCULATION_CONFIGURATION_REQUIRED');
    } else if (
      row.evaluationConfigurationVersion &&
      row.evaluationConfigurationVersion !==
        row.resolvedEvaluationConfigurationVersion
    ) {
      blockers.push('EVALUATION_RECALCULATION_CONFIGURATION_DRIFT');
    }
    return blockers;
  }

  private assertRecalculationIsSafe(preview: KioskApplicabilityAudit): void {
    if (preview.repairable) return;
    const blockedSubmissions = preview.submissions
      .filter(({ recalculationBlockers }) => recalculationBlockers.length)
      .map(({ submissionId, recalculationBlockers }) => ({
        submissionId,
        blockers: recalculationBlockers,
      }));
    throw new ConflictException({
      code: blockedSubmissions[0].blockers[0],
      message:
        'El lote contiene resultados que no pueden recalcularse de forma históricamente segura.',
      blockedSubmissions,
    });
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
          algorithmVersion: previousResult.algorithmVersion,
          evaluationConfigurationId: previousResult.evaluationConfigurationId,
          evaluationConfigurationVersion:
            previousResult.evaluationConfigurationVersion,
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
            algorithmVersion: recalculated.algorithmVersion,
            evaluationConfigurationId: recalculated.evaluationConfigurationId,
            evaluationConfigurationVersion:
              recalculated.evaluationConfigurationVersion,
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

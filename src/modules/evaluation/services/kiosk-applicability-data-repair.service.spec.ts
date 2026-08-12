import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SubmissionQuestionApplicability } from '../../submissions/entities/submission-question-applicability.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { EvaluationResult } from '../entities/evaluation-result.entity';
import { EVALUATION_ALGORITHM_VERSION } from '../evaluation.constants';
import { EvaluationResultsService } from './evaluation-results.service';
import { KioskApplicabilityDataRepairService } from './kiosk-applicability-data-repair.service';

describe('KioskApplicabilityDataRepairService', () => {
  const auditRow = {
    submissionId: 'submission-id',
    campaignId: 'campaign-id',
    schoolId: 'school-id',
    submittedAt: new Date('2026-08-01T12:00:00.000Z'),
    questionCodes: ['p021', 'p022'],
    affectedQuestionCount: 2,
    lastDecisionAt: new Date('2026-08-01T12:05:00.000Z'),
    generalScore: '55.5',
    generalNumerator: '333',
    generalDenominator: 6,
    calculatedAt: new Date('2026-08-01T12:06:00.000Z'),
    resultId: 'result-id',
    algorithmVersion: EVALUATION_ALGORITHM_VERSION,
    evaluationConfigurationId: 'configuration-id',
    evaluationConfigurationVersion: 'configuration-v1',
    resolvedEvaluationConfigurationVersion: 'configuration-v1',
  };
  const query =
    jest.fn<(sql: string, parameters?: unknown[]) => Promise<unknown[]>>();
  const transaction = jest.fn();
  const recalculateSubmissionWithManager = jest.fn();
  let service: KioskApplicabilityDataRepairService;

  beforeEach(() => {
    jest.clearAllMocks();
    const dataSource = { query, transaction } as unknown as DataSource;
    const evaluationResults = {
      recalculateSubmissionWithManager,
    } as unknown as EvaluationResultsService;
    service = new KioskApplicabilityDataRepairService(
      dataSource,
      evaluationResults,
    );
  });

  it('produces a read-only, deterministic audit of affected historical data', async () => {
    query.mockResolvedValue([auditRow]);

    const first = await service.audit('campaign-id');
    const second = await service.audit('campaign-id');

    expect(first).toMatchObject({
      affectedSubmissionCount: 1,
      affectedQuestionDecisionCount: 2,
      repairable: true,
      submissions: [
        {
          submissionId: 'submission-id',
          questionCodes: ['p021', 'p022'],
          previousResult: {
            generalScore: '55.5',
            generalDenominator: 6,
          },
        },
      ],
    });
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(transaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [
      ['p021', 'p022', 'p023', 'p024', 'p025', 'p026', 'p027'],
      'campaign-id',
      null,
    ]);
  });

  it('produces the fingerprint for the exact selected batch', async () => {
    query.mockResolvedValue([auditRow]);

    const preview = await service.preview(['submission-id']);

    expect(preview).toMatchObject({
      affectedSubmissionCount: 1,
      repairable: true,
      submissions: [
        {
          submissionId: 'submission-id',
          recalculationBlockers: [],
        },
      ],
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [
      ['p021', 'p022', 'p023', 'p024', 'p025', 'p026', 'p027'],
      null,
      ['submission-id'],
    ]);
  });

  it('rejects an oversized batch even when called outside the controller', async () => {
    await expect(
      service.preview(
        Array.from({ length: 501 }, (_, index) => `submission-${index}`),
      ),
    ).rejects.toMatchObject({
      response: { code: 'DATA_REPAIR_TARGET_LIMIT' },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports algorithm drift and blocks the repair before changing data', async () => {
    const driftedRow = {
      ...auditRow,
      algorithmVersion: 'question-average-legacy-v0',
    };
    query.mockResolvedValue([driftedRow]);
    const preview = await service.preview(['submission-id']);
    const save = jest.fn();
    const manager = {
      find: jest.fn().mockResolvedValue([{ id: 'submission-id' }]),
      query: jest.fn().mockResolvedValue([driftedRow]),
      save,
    } as unknown as EntityManager;
    transaction.mockImplementation(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager),
    );

    expect(preview).toMatchObject({
      repairable: false,
      submissions: [
        {
          recalculationBlockers: ['EVALUATION_RECALCULATION_ALGORITHM_DRIFT'],
        },
      ],
    });
    await expect(
      service.repair(['submission-id'], preview.fingerprint, true, 'actor-id'),
    ).rejects.toMatchObject({
      response: { code: 'EVALUATION_RECALCULATION_ALGORITHM_DRIFT' },
    });
    expect(save).not.toHaveBeenCalled();
    expect(recalculateSubmissionWithManager).not.toHaveBeenCalled();
  });

  it('rejects repair if selection or audited state no longer matches', async () => {
    const manager = {
      find: jest.fn().mockResolvedValue([{ id: 'submission-id' }]),
      query: jest.fn().mockResolvedValue([]),
    } as unknown as EntityManager;
    transaction.mockImplementation(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager),
    );

    await expect(
      service.repair(['submission-id'], '0'.repeat(64), true, 'actor-id'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('repairs decisions and recalculates atomically while preserving before/after audit', async () => {
    query.mockResolvedValue([auditRow]);
    const preview = await service.audit();
    const decisions = ['p021', 'p022'].map((questionCode, index) => ({
      id: `decision-${index}`,
      questionId: `question-${index}`,
      question: { code: questionCode },
      status: 'applicable' as const,
      appliedRuleId: `rule-${index}`,
      reasonCode: 'DEFAULT_SHOW' as const,
      reasonDescription: 'Regla anterior',
      missingFeatures: [],
      relevantSchoolFacts: { has_kiosk: false },
      evaluatedAt: new Date('2026-08-01T12:05:00.000Z'),
    }));
    const previousResult = {
      generalScore: '55.5',
      generalNumerator: '333',
      generalDenominator: 6,
      calculatedAt: new Date('2026-08-01T12:06:00.000Z'),
    };
    const save = jest.fn((_entity: unknown, value: unknown) =>
      Promise.resolve(value),
    );
    let createdAudit: unknown;
    const create = jest.fn((entity: unknown, value: unknown) => {
      if (entity === AuditLog) createdAudit = value;
      return value;
    });
    const managerQuery = jest.fn().mockResolvedValue([auditRow]);
    const manager = {
      find: jest.fn().mockResolvedValue([{ id: 'submission-id' }]),
      query: managerQuery,
      findOne: jest.fn((entity: unknown) => {
        if (entity === SurveySubmission)
          return Promise.resolve({
            id: 'submission-id',
            status: SubmissionStatus.Submitted,
            schoolProfileSnapshot: { hasKiosk: false },
            applicabilityDecisions: decisions,
          });
        if (entity === EvaluationResult) return Promise.resolve(previousResult);
        return Promise.resolve(null);
      }),
      save,
      create,
    } as unknown as EntityManager;
    transaction.mockImplementation(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager),
    );
    recalculateSubmissionWithManager.mockResolvedValue({
      generalScore: '62',
      generalNumerator: '310',
      generalDenominator: 5,
      calculatedAt: new Date('2026-08-01T12:10:00.000Z'),
    });

    const result = await service.repair(
      ['submission-id'],
      preview.fingerprint,
      true,
      'actor-id',
    );

    expect(result).toMatchObject({
      correctedSubmissionCount: 1,
      correctedQuestionDecisionCount: 2,
      submissions: [
        {
          submissionId: 'submission-id',
          generalScore: '62',
          generalDenominator: 5,
        },
      ],
    });
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'excluded',
          appliedRuleId: null,
          reasonCode: 'DATA_CORRECTION_KIOSK_NOT_APPLICABLE',
          relevantSchoolFacts: { has_kiosk: false },
        }),
      ]),
    );
    expect(save).toHaveBeenCalledWith(
      SubmissionQuestionApplicability,
      decisions,
    );
    expect(recalculateSubmissionWithManager).toHaveBeenCalledWith(
      manager,
      'submission-id',
      'actor-id',
      'system',
    );
    expect(managerQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        "set_config('ops.allow_kiosk_applicability_repair', 'on', true)",
      ),
    );
    const audit = createdAudit as
      | {
          action: string;
          changes: {
            beforeApplicability: unknown[];
            afterApplicability: unknown[];
            previousResult: { generalScore: string };
            recalculatedResult: { generalScore: string };
          };
        }
      | undefined;
    expect(audit?.action).toBe('KIOSK_APPLICABILITY_DATA_REPAIRED');
    expect(audit?.changes.beforeApplicability).toHaveLength(2);
    expect(audit?.changes.afterApplicability).toHaveLength(2);
    expect(audit?.changes.previousResult.generalScore).toBe('55.5');
    expect(audit?.changes.recalculatedResult.generalScore).toBe('62');
  });
});

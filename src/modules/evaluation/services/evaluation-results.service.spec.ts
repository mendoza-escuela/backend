import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UserRole } from '../../users/entities/user-role.enum';
import { ApplicabilityEngine } from '../../surveys/services/applicability-engine.service';
import {
  SurveyApplicabilityService,
  type SurveyApplicabilityResult,
} from '../../surveys/services/survey-applicability.service';
import { SurveyEvaluationService } from '../../surveys/services/survey-evaluation.service';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { OFFICIAL_SURVEY_DIMENSIONS } from '../../surveys/templates/official-survey-dimensions.template';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { EvaluationDimensionResult } from '../entities/evaluation-dimension-result.entity';
import { EvaluationResult } from '../entities/evaluation-result.entity';
import { EvaluationResultsService } from './evaluation-results.service';

describe('EvaluationResultsService', () => {
  const schoolsService = {
    evaluationContextForUser: jest.fn(),
  };
  const resultRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const submissionRepository = {
    findOne: jest.fn(),
  };
  let managerHarness: ReturnType<typeof createManagerHarness>;
  let service: EvaluationResultsService;

  beforeEach(() => {
    jest.clearAllMocks();
    managerHarness = createManagerHarness();
    const dataSource = {
      transaction: jest.fn(
        (callback: (manager: EntityManager) => Promise<unknown>) =>
          callback(managerHarness.manager),
      ),
      getRepository: jest.fn((entity: unknown) =>
        entity === SurveySubmission ? submissionRepository : resultRepository,
      ),
    } as unknown as DataSource;
    const applicabilityEngine = new ApplicabilityEngine();
    service = new EvaluationResultsService(
      dataSource,
      new SurveyEvaluationService(applicabilityEngine),
      new SurveyApplicabilityService(applicabilityEngine),
      schoolsService as never,
    );
  });

  it('creates one result with six dimensions and a self-contained snapshot', async () => {
    const fixture = evaluationFixture();
    const result = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      'actor-id',
      'submission_finalization',
    );

    expect(result.id).toBe('result-id');
    expect(result.generalScore).toBe('58.16666666');
    expect(result.generalNumerator).toBe('349');
    expect(result.generalDenominator).toBe(6);
    expect(result.dimensionResults).toHaveLength(6);
    expect(
      new Set(
        result.dimensionResults.map(({ dimensionCode }) => dimensionCode),
      ),
    ).toEqual(
      new Set(OFFICIAL_SURVEY_DIMENSIONS.map(({ code }) => code as string)),
    );

    const questions = result.snapshot.survey.dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) => section.questions),
    );
    const excluded = questions.find(({ code }) => code === 'p007');
    const applicable = questions.find(({ code }) => code === 'p001');
    expect(excluded).toMatchObject({
      applicability: {
        status: 'excluded',
        reasonCode: 'MATCHED_EXCLUSION_RULE',
        reasonDescription: 'La escuela no posee kiosco.',
      },
      scoreUsed: null,
    });
    expect(excluded?.rules).toHaveLength(1);
    expect(applicable).toMatchObject({
      applicability: { status: 'applicable' },
      scoreUsed: '100',
      answer: {
        selectedOption: {
          value: 'si',
          score: 100,
        },
      },
    });
    expect(result.snapshot.school.name).toBe('Escuela Histórica');
    expect(result.snapshot.algorithm.version).toBe(
      'question-average-dynamic-denominator-v1',
    );
    expect(result.stars).toBeNull();
    expect(result.starRuleVersion).toBeNull();
    expect(result.starBlockingReasons).toEqual([]);
    const mentalHealth = result.dimensionResults.find(
      ({ dimensionCode }) => dimensionCode === 'salud_mental',
    );
    expect(mentalHealth).toMatchObject({
      score: '100',
      isCritical: false,
      criticalValue: '100',
      criticalThreshold: '33',
      criticalRuleVersion: 'mental-health-critical-lt-33-v1',
    });
    expect(
      result.snapshot.survey.dimensions.find(
        ({ code }) => code === 'salud_mental',
      )?.result.criticality,
    ).toEqual({
      isCritical: false,
      value: '100',
      threshold: '33',
      operator: 'less_than',
      ruleVersion: 'mental-health-critical-lt-33-v1',
    });
    expect(result.snapshot.result.stars).toEqual({
      value: null,
      ruleVersion: null,
      blockingReasons: [],
    });
    expect(managerHarness.audits[0]).toMatchObject({
      action: 'EVALUATION_RESULT_CREATED',
      actorUserId: 'actor-id',
    });
  });

  it('preserves result calculation for a campaign linked to an archived version', async () => {
    const fixture = evaluationFixture();
    fixture.version.status = 'archived' as SurveyVersion['status'];

    await expect(
      service.calculateAndPersist(
        managerHarness.manager,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        'actor-id',
        'submission_finalization',
      ),
    ).resolves.toMatchObject({ surveyVersionId: fixture.version.id });
  });

  it('overwrites the same result and completely replaces its snapshot', async () => {
    const fixture = evaluationFixture();
    const originalAnswers = structuredClone(fixture.submission.answers);
    const first = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      'actor-id',
      'submission_finalization',
    );
    const firstSnapshot = first.snapshot;

    fixture.submission.answers[0].optionId =
      fixture.version.dimensions[0].sections[0].questions[0].options[1].id;
    const recalculated = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      'actor-id',
      'single_recalculation',
    );

    expect(recalculated.id).toBe(first.id);
    expect(managerHarness.rootSaveCount).toBe(2);
    expect(managerHarness.dimensionDeleteCount).toBe(2);
    expect(recalculated.snapshot).not.toBe(firstSnapshot);
    expect(firstSnapshot.result.generalScore).toBe('58.16666666');
    expect(recalculated.snapshot.result.generalScore).toBe('41.5');
    expect(recalculated.dimensionResults).toHaveLength(6);
    expect(managerHarness.audits.at(-1)?.action).toBe(
      'EVALUATION_RESULT_RECALCULATED',
    );
    expect(originalAnswers[1]).toEqual(fixture.submission.answers[1]);
  });

  it('keeps the stored snapshot unchanged after current school or survey data changes', async () => {
    const fixture = evaluationFixture();
    const result = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      null,
      'system',
    );

    fixture.submission.schoolProfileSnapshot!.name = 'Nombre actualizado';
    fixture.version.dimensions[0].sections[0].questions[0].prompt =
      'Pregunta actualizada';

    expect(result.snapshot.school.name).toBe('Escuela Histórica');
    expect(
      result.snapshot.survey.dimensions[0].sections[0].questions[0].prompt,
    ).toBe('Pregunta 1');
  });

  it('persists applicable and excluded questions, reasons and scores used', async () => {
    const fixture = evaluationFixture();
    const result = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      null,
      'system',
    );
    const questions = result.snapshot.survey.dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) => section.questions),
    );

    expect(
      questions.filter(
        ({ applicability }) => applicability.status === 'applicable',
      ),
    ).toHaveLength(6);
    expect(
      questions.filter(
        ({ applicability }) => applicability.status === 'excluded',
      ),
    ).toHaveLength(1);
    expect(
      questions
        .filter(({ applicability }) => applicability.status === 'applicable')
        .map(({ scoreUsed }) => scoreUsed),
    ).toEqual(['100', '50', '0', '66', '33', '100']);
  });

  it.each([
    {
      score: '32.99',
      optionScores: [...Array.from({ length: 99 }, () => 33), 32],
      expectedCritical: true,
    },
    {
      score: '33',
      optionScores: Array.from({ length: 100 }, () => 33),
      expectedCritical: false,
    },
  ])(
    'persists mental health score $score with critical=$expectedCritical',
    async ({ score, optionScores, expectedCritical }) => {
      const fixture = evaluationFixture();
      setMentalHealthQuestions(fixture, optionScores);

      const result = await service.calculateAndPersist(
        managerHarness.manager,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        null,
        'system',
      );
      const mentalHealth = result.dimensionResults.find(
        ({ dimensionCode }) => dimensionCode === 'salud_mental',
      );
      const snapshotMentalHealth = result.snapshot.survey.dimensions.find(
        ({ code }) => code === 'salud_mental',
      );

      expect(mentalHealth).toMatchObject({
        score,
        isCritical: expectedCritical,
        criticalValue: score,
        criticalThreshold: '33',
        criticalRuleVersion: 'mental-health-critical-lt-33-v1',
      });
      expect(snapshotMentalHealth?.result.criticality).toEqual({
        isCritical: expectedCritical,
        value: score,
        threshold: '33',
        operator: 'less_than',
        ruleVersion: 'mental-health-critical-lt-33-v1',
      });
      expect(result.stars).toBeNull();
      expect(result.snapshot.result.stars.value).toBeNull();
    },
  );

  it.each([
    {
      name: 'an unknown dimension',
      change: (fixture: ReturnType<typeof evaluationFixture>) => {
        fixture.version.dimensions[0].code = 'dimension_desconocida';
      },
      message: /seis dimensiones oficiales/i,
    },
    {
      name: 'an option score outside the valid range',
      change: (fixture: ReturnType<typeof evaluationFixture>) => {
        fixture.version.dimensions[0].sections[0].questions[0].options[0].score = 101;
      },
      message: /puntaje inválido/i,
    },
    {
      name: 'an excluded question without its reason',
      change: (fixture: ReturnType<typeof evaluationFixture>) => {
        fixture.applicability.decisions[6].reasonDescription = '';
      },
      message: /motivo de exclusión/i,
    },
    {
      name: 'an incomplete applicability snapshot',
      change: (fixture: ReturnType<typeof evaluationFixture>) => {
        fixture.applicability.decisions.pop();
      },
      message: /snapshot de aplicabilidad está incompleto/i,
    },
  ])('rejects $name', async ({ change, message }) => {
    const fixture = evaluationFixture();
    change(fixture);

    await expect(
      service.calculateAndPersist(
        managerHarness.manager,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        null,
        'system',
      ),
    ).rejects.toThrow(message);
    expect(managerHarness.rootSaveCount).toBe(0);
  });

  it('uses a pessimistic submission lock and surfaces a transactional write failure', async () => {
    const fixture = evaluationFixture();
    managerHarness.failDimensionSave = true;

    await expect(
      service.calculateAndPersist(
        managerHarness.manager,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        null,
        'system',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(managerHarness.findOne).toHaveBeenCalledWith(
      SurveySubmission,
      expect.objectContaining({
        where: { id: fixture.submission.id },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(managerHarness.audits).toHaveLength(0);
  });

  it('serializes two concurrent calculations without creating duplicate results', async () => {
    const fixture = evaluationFixture();
    const concurrent = createConcurrentManagerHarness();

    const [first, second] = await Promise.all([
      service.calculateAndPersist(
        concurrent.first,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        null,
        'system',
      ),
      service.calculateAndPersist(
        concurrent.second,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        null,
        'system',
      ),
    ]);

    expect(first.id).toBe('shared-result-id');
    expect(second.id).toBe('shared-result-id');
    expect(concurrent.createdRootCount).toBe(1);
  });

  it('rolls back the staged result when a later write fails', async () => {
    const fixture = evaluationFixture();
    let committedResult: EvaluationResult | null = null;
    const transactionalDataSource = {
      transaction: jest.fn(
        async (callback: (manager: EntityManager) => Promise<unknown>) => {
          let stagedResult = committedResult;
          const transactionalManager = {
            findOne: jest.fn((entity: unknown, options: unknown) => {
              if (entity === EvaluationResult) {
                return Promise.resolve(stagedResult);
              }
              if (
                entity === SurveySubmission &&
                typeof options === 'object' &&
                options !== null &&
                'relations' in options
              ) {
                return Promise.resolve(fixture.submission);
              }
              if (entity === SurveySubmission) {
                return Promise.resolve({ id: fixture.submission.id });
              }
              return Promise.resolve(null);
            }),
            create: jest.fn(
              (
                entity: new () => unknown,
                attributes: Record<string, unknown> = {},
              ) => Object.assign(new entity(), attributes),
            ),
            save: jest.fn((entity: unknown, value: unknown) => {
              if (entity === EvaluationResult) {
                stagedResult = Object.assign(value as EvaluationResult, {
                  id: 'staged-result-id',
                });
                return Promise.resolve(stagedResult);
              }
              if (entity === EvaluationDimensionResult) {
                return Promise.reject(new Error('dimension write failed'));
              }
              return Promise.resolve(value);
            }),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
          } as unknown as EntityManager;

          const value = await callback(transactionalManager);
          committedResult = stagedResult;
          return value;
        },
      ),
      getRepository: jest.fn(() => resultRepository),
    } as unknown as DataSource;
    const applicabilityEngine = new ApplicabilityEngine();
    const transactionalService = new EvaluationResultsService(
      transactionalDataSource,
      new SurveyEvaluationService(applicabilityEngine),
      new SurveyApplicabilityService(applicabilityEngine),
      schoolsService as never,
    );

    await expect(
      transactionalService.recalculateSubmission(fixture.submission.id, null),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(committedResult).toBeNull();
  });

  it('queries results using the school resolved from the authenticated session', async () => {
    const fixture = evaluationFixture();
    const persisted = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      null,
      'system',
    );
    persisted.campaign = {
      id: fixture.submission.campaignId,
      name: 'Campaña 2026',
      type: 'annual',
    } as never;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: { id: 'school-id' },
    });
    submissionRepository.findOne.mockResolvedValue({
      id: fixture.submission.id,
      status: fixture.submission.status,
      submittedAt: fixture.submission.submittedAt,
    });
    resultRepository.findOne.mockResolvedValue(persisted);

    const preliminaryResult = await service.resultForSchool(
      'campaign-id',
      schoolActor(),
    );
    expect(preliminaryResult).toMatchObject({
      id: 'result-id',
      school: {
        id: 'school-id',
        name: 'Escuela Histórica',
      },
      campaign: {
        id: 'campaign-id',
        name: 'Campaña 2026',
      },
      result: {
        generalScore: 58.16666666,
      },
      calculation: {
        algorithmVersion: 'question-average-dynamic-denominator-v1',
      },
    });
    expect(
      preliminaryResult.result.dimensions.find(
        ({ code }) => code === 'salud_mental',
      ),
    ).toMatchObject({
      score: 100,
      isCritical: false,
    });
    expect(resultRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          submissionId: fixture.submission.id,
          schoolId: fixture.submission.schoolId,
        },
      }),
    );

    resultRepository.findOne.mockResolvedValue(null);
    await expect(
      service.resultForSchool('another-campaign-id', {
        id: 'school-user-id',
        firstName: 'Ana',
        lastName: 'Directora',
        email: 'escuela@example.com',
        role: UserRole.School,
        sessionId: 'session-id',
        mustChangePassword: false,
        lastLoginAt: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('distinguishes a draft from a submitted presentation without a result', async () => {
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: { id: 'school-id' },
    });
    submissionRepository.findOne.mockResolvedValueOnce({
      id: 'submission-id',
      status: 'draft',
      submittedAt: null,
    });

    await expect(
      service.resultForSchool('campaign-id', schoolActor()),
    ).rejects.toMatchObject({
      response: { code: 'SUBMISSION_DRAFT' },
    });
    expect(resultRepository.findOne).not.toHaveBeenCalled();

    submissionRepository.findOne.mockResolvedValueOnce({
      id: 'submission-id',
      status: 'submitted',
      submittedAt: new Date(),
    });
    resultRepository.findOne.mockResolvedValueOnce(null);

    await expect(
      service.resultForSchool('campaign-id', schoolActor()),
    ).rejects.toMatchObject({
      response: {
        code: 'PRELIMINARY_RESULT_NOT_GENERATED',
      },
    });
  });

  it('does not expose another school result when the authenticated school has no presentation', async () => {
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: { id: 'authenticated-school-id' },
    });
    submissionRepository.findOne.mockResolvedValue(null);

    await expect(
      service.resultForSchool('campaign-id', schoolActor()),
    ).rejects.toMatchObject({
      response: { code: 'SUBMISSION_NOT_FOUND' },
    });
    expect(submissionRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campaignId: 'campaign-id',
          schoolId: 'authenticated-school-id',
        },
      }),
    );
    expect(resultRepository.findOne).not.toHaveBeenCalled();
  });

  it('returns a controlled error when the historical snapshot is incomplete', async () => {
    const fixture = evaluationFixture();
    const persisted = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      null,
      'system',
    );
    persisted.campaign = {
      id: fixture.submission.campaignId,
      name: 'Campaña 2026',
      type: 'annual',
    } as never;
    persisted.snapshot.survey.dimensions[0].sections = undefined as never;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: { id: fixture.submission.schoolId },
    });
    submissionRepository.findOne.mockResolvedValue({
      id: fixture.submission.id,
      status: fixture.submission.status,
      submittedAt: fixture.submission.submittedAt,
    });
    resultRepository.findOne.mockResolvedValue(persisted);

    await expect(
      service.resultForSchool(fixture.submission.campaignId, schoolActor()),
    ).rejects.toMatchObject({
      response: { code: 'HISTORICAL_RESULT_INCOMPLETE' },
    });
  });

  it('returns unavailable dimensions without converting them to zero', async () => {
    const fixture = evaluationFixture();
    const persisted = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      null,
      'system',
    );
    persisted.campaign = {
      id: fixture.submission.campaignId,
      name: 'Campaña 2026',
      type: 'annual',
    } as never;
    persisted.snapshot.survey.dimensions =
      persisted.snapshot.survey.dimensions.slice(0, 5);
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: { id: 'school-id' },
    });
    submissionRepository.findOne.mockResolvedValue({
      id: fixture.submission.id,
      status: fixture.submission.status,
      submittedAt: fixture.submission.submittedAt,
    });
    resultRepository.findOne.mockResolvedValue(persisted);

    const result = await service.resultForSchool(
      fixture.submission.campaignId,
      schoolActor(),
    );

    expect(result.result.dimensions).toHaveLength(6);
    expect(result.result.dimensions.at(-1)).toMatchObject({
      code: 'salud_mental',
      score: null,
      available: false,
    });
    expect(result.dataQuality.complete).toBe(false);
  });

  it('lists only persisted results resolved from the authenticated school', async () => {
    const fixture = evaluationFixture();
    const persisted = await service.calculateAndPersist(
      managerHarness.manager,
      fixture.submission,
      fixture.version,
      fixture.applicability,
      null,
      'system',
    );
    persisted.campaign = {
      id: fixture.submission.campaignId,
      name: 'Campaña 2026',
      type: 'annual',
    } as never;
    persisted.submission = fixture.submission;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: { id: fixture.submission.schoolId },
    });
    resultRepository.find.mockResolvedValue([persisted]);

    const list = await service.resultsForSchool(schoolActor());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      id: 'result-id',
      campaign: { name: 'Campaña 2026' },
      generalScore: 58.16666666,
    });
    expect(resultRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          schoolId: fixture.submission.schoolId,
          submission: { status: 'submitted' },
        },
      }),
    );
  });

  it('rejects a response whose option belongs to another question', async () => {
    const fixture = evaluationFixture();
    fixture.submission.answers[0].optionId =
      fixture.version.dimensions[1].sections[0].questions[0].options[0].id;

    await expect(
      service.calculateAndPersist(
        managerHarness.manager,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        null,
        'system',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a response associated with another presentation', async () => {
    const fixture = evaluationFixture();
    fixture.submission.answers[0].submissionId = 'another-submission-id';

    await expect(
      service.calculateAndPersist(
        managerHarness.manager,
        fixture.submission,
        fixture.version,
        fixture.applicability,
        null,
        'system',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function schoolActor() {
  return {
    id: 'school-user-id',
    firstName: 'Ana',
    lastName: 'Directora',
    email: 'escuela@example.com',
    role: UserRole.School,
    sessionId: 'session-id',
    mustChangePassword: false,
    lastLoginAt: null,
  };
}

function createManagerHarness() {
  let result: EvaluationResult | null = null;
  const audits: AuditLog[] = [];
  let rootSaveCount = 0;
  let dimensionDeleteCount = 0;
  let failDimensionSave = false;

  const findOne = jest.fn((entity: unknown) => {
    if (entity === SurveySubmission)
      return Promise.resolve({ id: 'submission-id' });
    if (entity === EvaluationResult) return Promise.resolve(result);
    return Promise.resolve(null);
  });
  const manager = {
    findOne,
    create: jest.fn(
      (entity: new () => unknown, attributes: Record<string, unknown> = {}) =>
        Object.assign(new entity(), attributes),
    ),
    save: jest.fn((entity: unknown, value: unknown) => {
      if (entity === EvaluationResult) {
        rootSaveCount += 1;
        result = Object.assign(value as EvaluationResult, {
          id: (value as EvaluationResult).id ?? 'result-id',
        });
        return Promise.resolve(result);
      }
      if (entity === EvaluationDimensionResult) {
        if (failDimensionSave) return Promise.reject(new Error('db failure'));
        return Promise.resolve(
          (value as EvaluationDimensionResult[]).map((dimension, index) =>
            Object.assign(dimension, { id: `dimension-result-${index + 1}` }),
          ),
        );
      }
      if (entity === AuditLog) {
        audits.push(value as AuditLog);
      }
      return Promise.resolve(value);
    }),
    delete: jest.fn((entity: unknown) => {
      if (entity === EvaluationDimensionResult) dimensionDeleteCount += 1;
      return Promise.resolve({ affected: 6 });
    }),
  } as unknown as EntityManager;

  return {
    manager,
    findOne,
    audits,
    get rootSaveCount() {
      return rootSaveCount;
    },
    get dimensionDeleteCount() {
      return dimensionDeleteCount;
    },
    get failDimensionSave() {
      return failDimensionSave;
    },
    set failDimensionSave(value: boolean) {
      failDimensionSave = value;
    },
  };
}

function createConcurrentManagerHarness() {
  let result: EvaluationResult | null = null;
  let createdRootCount = 0;
  let locked = false;
  const waiters: Array<() => void> = [];

  const release = () => {
    locked = false;
    waiters.shift()?.();
  };
  const manager = () => {
    let ownsSubmissionLock = false;
    return {
      findOne: jest.fn((entity: unknown) => {
        if (entity === SurveySubmission) {
          if (!locked) {
            locked = true;
            ownsSubmissionLock = true;
            return Promise.resolve({ id: 'submission-id' });
          }
          return new Promise((resolve) => {
            waiters.push(() => {
              locked = true;
              ownsSubmissionLock = true;
              resolve({ id: 'submission-id' });
            });
          });
        }
        if (entity === EvaluationResult) return Promise.resolve(result);
        return Promise.resolve(null);
      }),
      create: jest.fn(
        (entity: new () => unknown, attributes: Record<string, unknown> = {}) =>
          Object.assign(new entity(), attributes),
      ),
      save: jest.fn((entity: unknown, value: unknown) => {
        if (entity === EvaluationResult) {
          if (!(value as EvaluationResult).id) createdRootCount += 1;
          result = Object.assign(value as EvaluationResult, {
            id: (value as EvaluationResult).id ?? 'shared-result-id',
          });
          return Promise.resolve(result);
        }
        if (entity === EvaluationDimensionResult) {
          return Promise.resolve(value);
        }
        if (entity === AuditLog && ownsSubmissionLock) {
          ownsSubmissionLock = false;
          release();
        }
        return Promise.resolve(value);
      }),
      delete: jest.fn().mockResolvedValue({ affected: 6 }),
    } as unknown as EntityManager;
  };

  return {
    first: manager(),
    second: manager(),
    get createdRootCount() {
      return createdRootCount;
    },
  };
}

function evaluationFixture() {
  const selectedScores = [100, 50, 0, 66, 33, 100];
  const dimensions = OFFICIAL_SURVEY_DIMENSIONS.map((definition, index) => {
    const number = index + 1;
    const questionId = `question-${number}`;
    return {
      id: `dimension-${number}`,
      versionId: 'version-id',
      code: definition.code,
      title: definition.title,
      description: definition.description,
      order: definition.order,
      sections: [
        {
          id: `section-${number}`,
          dimensionId: `dimension-${number}`,
          code: `s${number}`,
          title: `Sección ${number}`,
          description: null,
          order: 1,
          questions: [
            {
              id: questionId,
              sectionId: `section-${number}`,
              code: `p00${number}`,
              type: 'single_choice',
              prompt: `Pregunta ${number}`,
              helpText: null,
              required: true,
              order: 1,
              validation: {},
              applicabilityRules: [],
              options: [
                {
                  id: `option-${number}-selected`,
                  questionId,
                  value: 'si',
                  label: 'Sí',
                  helpText: null,
                  score: selectedScores[index],
                  order: 1,
                },
                {
                  id: `option-${number}-zero`,
                  questionId,
                  value: 'no',
                  label: 'No',
                  helpText: null,
                  score: 0,
                  order: 2,
                },
              ],
            },
          ],
        },
      ],
    };
  });
  const excludedQuestion = {
    id: 'question-7',
    sectionId: 'section-6',
    code: 'p007',
    type: 'single_choice',
    prompt: 'Pregunta condicional',
    helpText: null,
    required: true,
    order: 2,
    validation: {},
    applicabilityRules: [
      {
        id: 'rule-7',
        questionId: 'question-7',
        groupOperator: 'all',
        action: 'omit',
        defaultAction: 'show',
        order: 1,
        conditions: [
          {
            id: 'condition-7',
            ruleId: 'rule-7',
            feature: 'hasKiosk',
            operator: 'equals',
            expectedValue: false,
            order: 1,
          },
        ],
      },
    ],
    options: [
      {
        id: 'option-7-selected',
        questionId: 'question-7',
        value: 'si',
        label: 'Sí',
        helpText: null,
        score: 100,
        order: 1,
      },
      {
        id: 'option-7-zero',
        questionId: 'question-7',
        value: 'no',
        label: 'No',
        helpText: null,
        score: 0,
        order: 2,
      },
    ],
  };
  dimensions[5].sections[0].questions.push(excludedQuestion as never);

  const evaluatedAt = new Date('2026-07-30T12:00:00.000Z');
  const decisions = dimensions.flatMap((dimension) =>
    dimension.sections.flatMap((section) =>
      section.questions.map((question) => ({
        questionId: question.id,
        questionCode: question.code,
        surveyVersionId: 'version-id',
        status: question.id === 'question-7' ? 'excluded' : 'applicable',
        appliedRuleId: question.id === 'question-7' ? 'rule-7' : null,
        reasonCode:
          question.id === 'question-7'
            ? 'MATCHED_EXCLUSION_RULE'
            : 'NO_APPLICABILITY_RULES',
        reasonDescription:
          question.id === 'question-7'
            ? 'La escuela no posee kiosco.'
            : 'La pregunta no tiene reglas de aplicabilidad.',
        missingFeatures: [],
        relevantSchoolFacts:
          question.id === 'question-7' ? { hasKiosk: false } : {},
        evaluatedAt,
      })),
    ),
  );
  const answers = dimensions.flatMap((dimension) =>
    dimension.sections.flatMap((section) =>
      section.questions.map((question) => ({
        id: `answer-${question.id}`,
        submissionId: 'submission-id',
        questionId: question.id,
        optionId: question.options[0].id,
        value: null,
        updatedAt: new Date('2026-07-30T11:00:00.000Z'),
      })),
    ),
  );
  const applicabilityDecisions = decisions.map((decision) => ({
    id: `decision-${decision.questionId}`,
    submissionId: 'submission-id',
    questionId: decision.questionId,
    surveyVersionId: decision.surveyVersionId,
    appliedRuleId: decision.appliedRuleId,
    status: decision.status,
    reasonCode: decision.reasonCode,
    reasonDescription: decision.reasonDescription,
    missingFeatures: decision.missingFeatures,
    relevantSchoolFacts: decision.relevantSchoolFacts,
    evaluatedAt: decision.evaluatedAt,
  }));
  const version = {
    id: 'version-id',
    surveyId: 'survey-id',
    survey: {
      id: 'survey-id',
      code: 'institucional',
      name: 'Cuestionario institucional',
      description: 'Cuestionario oficial',
    },
    versionNumber: 1,
    title: 'Versión publicada',
    instructions: 'Responder institucionalmente.',
    status: 'published',
    publishedAt: new Date('2026-07-01T12:00:00.000Z'),
    dimensions,
  };
  const submission = {
    id: 'submission-id',
    campaignId: 'campaign-id',
    schoolId: 'school-id',
    surveyVersionId: 'version-id',
    schoolRectificationId: 'rectification-id',
    schoolProfileSnapshot: {
      name: 'Escuela Histórica',
      cue: '500000001',
      directorName: 'Ana Directora',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Primario',
      shift: 'Simple',
      hasKiosk: false,
    },
    originalRespondentId: 'actor-id',
    originalRespondentSnapshot: {
      id: 'actor-id',
      firstName: 'Ana',
      lastName: 'Directora',
      email: 'escuela@example.com',
    },
    status: 'submitted',
    startedAt: new Date('2026-07-30T10:00:00.000Z'),
    submittedAt: new Date('2026-07-30T12:00:00.000Z'),
    answers,
    applicabilityDecisions,
    surveyVersion: version,
  };

  return {
    version: version as unknown as SurveyVersion,
    submission: submission as unknown as SurveySubmission,
    applicability: {
      surveyVersionId: 'version-id',
      status: 'ready',
      source: 'persisted',
      evaluatedAt,
      decisions,
      applicableQuestionIds: new Set(
        decisions
          .filter(({ status }) => status === 'applicable')
          .map(({ questionId }) => questionId),
      ),
      excludedQuestionIds: new Set(['question-7']),
      incompleteQuestionIds: new Set<string>(),
      missingFields: [],
    } as unknown as SurveyApplicabilityResult,
  };
}

function setMentalHealthQuestions(
  fixture: ReturnType<typeof evaluationFixture>,
  optionScores: number[],
) {
  const dimension = fixture.version.dimensions.find(
    ({ code }) => code === 'salud_mental',
  )!;
  const section = dimension.sections[0];
  const previousQuestionIds = new Set(section.questions.map(({ id }) => id));
  const excludedQuestion = section.questions.find(
    ({ code }) => code === 'p007',
  )!;
  const excludedAnswer = fixture.submission.answers.find(
    ({ questionId }) => questionId === excludedQuestion.id,
  )!;
  const excludedDecision = fixture.applicability.decisions.find(
    ({ questionId }) => questionId === excludedQuestion.id,
  )!;
  excludedQuestion.order = optionScores.length + 1;
  const evaluatedAt = new Date('2026-07-30T12:00:00.000Z');
  const questions = optionScores.map((score, index) => {
    const number = index + 1;
    const questionId = `mental-question-${number}`;
    return {
      id: questionId,
      sectionId: section.id,
      code: `mh${String(number).padStart(3, '0')}`,
      type: 'single_choice',
      prompt: `Pregunta de Salud Mental ${number}`,
      helpText: null,
      required: true,
      order: number,
      validation: {},
      applicabilityRules: [],
      options: [
        {
          id: `mental-option-${number}`,
          questionId,
          value: 'respuesta',
          label: 'Respuesta',
          helpText: null,
          score,
          order: 1,
        },
      ],
    };
  });
  const decisions = questions.map((question) => ({
    questionId: question.id,
    questionCode: question.code,
    surveyVersionId: fixture.version.id,
    status: 'applicable' as const,
    appliedRuleId: null,
    reasonCode: 'NO_APPLICABILITY_RULES' as const,
    reasonDescription: 'La pregunta no tiene reglas de aplicabilidad.',
    missingFeatures: [],
    relevantSchoolFacts: {},
    evaluatedAt,
  }));

  section.questions = [...questions, excludedQuestion] as never;
  fixture.submission.answers = [
    ...fixture.submission.answers.filter(
      ({ questionId }) => !previousQuestionIds.has(questionId),
    ),
    ...questions.map((question) => ({
      id: `answer-${question.id}`,
      submissionId: fixture.submission.id,
      questionId: question.id,
      optionId: question.options[0].id,
      value: null,
      updatedAt: new Date('2026-07-30T11:00:00.000Z'),
    })),
    excludedAnswer,
  ] as never;
  fixture.applicability.decisions = [
    ...fixture.applicability.decisions.filter(
      ({ questionId }) => !previousQuestionIds.has(questionId),
    ),
    ...decisions,
    excludedDecision,
  ];
  fixture.applicability.applicableQuestionIds = new Set(
    fixture.applicability.decisions
      .filter(({ status }) => status === 'applicable')
      .map(({ questionId }) => questionId),
  );
  fixture.applicability.excludedQuestionIds = new Set([excludedQuestion.id]);
  fixture.submission.applicabilityDecisions =
    fixture.applicability.decisions.map((decision) => ({
      id: `decision-${decision.questionId}`,
      submissionId: fixture.submission.id,
      questionId: decision.questionId,
      surveyVersionId: decision.surveyVersionId,
      appliedRuleId: decision.appliedRuleId,
      status: decision.status,
      reasonCode: decision.reasonCode,
      reasonDescription: decision.reasonDescription,
      missingFeatures: decision.missingFeatures,
      relevantSchoolFacts: decision.relevantSchoolFacts,
      evaluatedAt: decision.evaluatedAt,
    })) as never;
}

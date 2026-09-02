import { DataSource, EntityManager } from 'typeorm';
import { ConflictException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { UserRole } from '../../users/entities/user-role.enum';
import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
  SurveyApplicabilityRule,
} from '../entities/survey-applicability-rule.entity';
import { SurveyQuestion } from '../entities/survey-question.entity';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { ApplicabilityEngine } from './applicability-engine.service';
import { ApplicabilityRulesService } from './applicability-rules.service';

describe('ApplicabilityRulesService bulk creation', () => {
  const expectedUpdatedAt = '2026-08-01T00:00:00.000Z';
  const actor: AuthenticatedUser = {
    id: 'actor-id',
    firstName: 'Admin',
    lastName: 'Central',
    email: 'admin@example.com',
    role: UserRole.Admin,
    sessionId: 'session-id',
    mustChangePassword: false,
    lastLoginAt: null,
  };
  const manager = {
    create: jest.fn(
      (_entity: unknown, attributes: Record<string, unknown>) => attributes,
    ),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  } as unknown as DataSource;
  let service: ApplicabilityRulesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApplicabilityRulesService(
      dataSource,
      {} as ApplicabilityEngine,
    );
    jest
      .spyOn(service as never, 'assertMutableQuestion' as never)
      .mockResolvedValue({
        id: 'version-id',
        surveyId: 'survey-id',
        status: SurveyVersionStatus.Draft,
        updatedAt: new Date(expectedUpdatedAt),
      } as never);
    jest
      .spyOn(service as never, 'assertDefaultAction' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'saveConditions' as never)
      .mockResolvedValue([] as never);
    jest
      .spyOn(service as never, 'audit' as never)
      .mockResolvedValue({} as never);
    jest
      .spyOn(service as never, 'touchVersion' as never)
      .mockResolvedValue('2026-08-01T00:00:00.001Z' as never);
  });

  it('creates one appended rule per question in a single transaction', async () => {
    const previousOrders = new Map([
      ['question-1', 2],
      ['question-2', 0],
    ]);
    manager.findOne.mockImplementation(
      (
        _entity: unknown,
        options: { where: { questionId?: string; id?: string } },
      ) => {
        if (options.where.id)
          return {
            id: options.where.id,
            questionId: options.where.id.endsWith('1')
              ? 'question-1'
              : 'question-2',
            conditions: [],
          };
        const order = previousOrders.get(options.where.questionId ?? '');
        return order === undefined ? null : { order };
      },
    );
    let ruleSequence = 0;
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) =>
        entity === SurveyApplicabilityRule
          ? { ...attributes, id: `rule-${++ruleSequence}` }
          : attributes,
    );

    const created = await service.createBulk(
      'survey-id',
      'version-id',
      {
        expectedUpdatedAt,
        questionIds: ['question-1', 'question-2'],
        rule: {
          groupOperator: ApplicabilityGroupOperator.All,
          action: ApplicabilityAction.Omit,
          defaultAction: ApplicabilityAction.Show,
          order: 99,
          conditions: [
            {
              feature: 'has_kiosk',
              operator: 'equals',
              expectedValue: true,
              order: 0,
            },
          ],
        },
      },
      actor,
    );

    expect(created.rules).toHaveLength(2);
    expect(created.versionUpdatedAt).toBe('2026-08-01T00:00:00.001Z');
    expect(manager.save).toHaveBeenCalledWith(
      SurveyApplicabilityRule,
      expect.objectContaining({ questionId: 'question-1', order: 3 }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      SurveyApplicabilityRule,
      expect.objectContaining({ questionId: 'question-2', order: 1 }),
    );
    expect(
      (dataSource.transaction as jest.MockedFunction<DataSource['transaction']>)
        .mock.calls,
    ).toHaveLength(1);
  });

  it('does not persist rules when validation of any target question fails', async () => {
    const assertMutable = jest.spyOn(
      service as never,
      'assertMutableQuestion' as never,
    );
    assertMutable
      .mockResolvedValueOnce({
        id: 'version-id',
        surveyId: 'survey-id',
        status: SurveyVersionStatus.Draft,
        updatedAt: new Date(expectedUpdatedAt),
      } as never)
      .mockRejectedValueOnce(new Error('Pregunta inválida') as never);

    await expect(
      service.createBulk(
        'survey-id',
        'version-id',
        {
          expectedUpdatedAt,
          questionIds: ['question-1', 'question-2'],
          rule: {
            groupOperator: ApplicabilityGroupOperator.All,
            action: ApplicabilityAction.Omit,
            defaultAction: ApplicabilityAction.Show,
            order: 0,
            conditions: [
              {
                feature: 'has_kiosk',
                operator: 'equals',
                expectedValue: true,
                order: 0,
              },
            ],
          },
        },
        actor,
      ),
    ).rejects.toThrow('Pregunta inválida');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects a bulk operation with fewer than two questions in the service', async () => {
    await expect(
      service.createBulk(
        'survey-id',
        'version-id',
        {
          expectedUpdatedAt,
          questionIds: ['question-1'],
          rule: ruleInput(expectedUpdatedAt),
        },
        actor,
      ),
    ).rejects.toThrow('Seleccioná al menos dos preguntas');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('locks the parent version before validating a mutable question', async () => {
    const mutableAssertion = jest.spyOn(
      service as never,
      'assertMutableQuestion' as never,
    );
    mutableAssertion.mockRestore();
    manager.findOne.mockResolvedValue({
      id: 'version-id',
      surveyId: 'survey-id',
      status: SurveyVersionStatus.Draft,
    });
    const questionBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ question_id: 'question-id' }),
    };
    const getRepository = jest.fn((entity: unknown) => {
      expect(entity).toBe(SurveyQuestion);
      return { createQueryBuilder: jest.fn(() => questionBuilder) };
    });
    (manager as typeof manager & { getRepository: jest.Mock }).getRepository =
      getRepository;

    await (
      service as unknown as {
        assertMutableQuestion(
          entityManager: EntityManager,
          surveyId: string,
          versionId: string,
          questionId: string,
        ): Promise<void>;
      }
    ).assertMutableQuestion(
      manager as unknown as EntityManager,
      'survey-id',
      'version-id',
      'question-id',
    );

    expect(manager.findOne).toHaveBeenCalledWith(SurveyVersion, {
      where: { id: 'version-id', surveyId: 'survey-id' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(questionBuilder.getRawOne).toHaveBeenCalledTimes(1);
  });

  it('reads rules and their revision under one shared parent lock', async () => {
    const rules = [{ id: 'rule-1', questionId: 'question-1' }];
    manager.findOne.mockResolvedValue({
      id: 'version-id',
      surveyId: 'survey-id',
      updatedAt: new Date(expectedUpdatedAt),
    });
    const ruleBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rules),
    };
    (manager as typeof manager & { getRepository: jest.Mock }).getRepository =
      jest.fn(() => ({ createQueryBuilder: jest.fn(() => ruleBuilder) }));

    await expect(service.list('survey-id', 'version-id')).resolves.toEqual({
      rules,
      versionUpdatedAt: expectedUpdatedAt,
    });
    expect(manager.findOne).toHaveBeenCalledWith(SurveyVersion, {
      where: { id: 'version-id', surveyId: 'survey-id' },
      lock: { mode: 'pessimistic_read' },
    });
    expect(ruleBuilder.getMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'create',
      () =>
        service.create(
          'survey-id',
          'version-id',
          'question-1',
          ruleInput('2026-07-31T23:59:59.000Z'),
          actor,
        ),
    ],
    [
      'bulk create',
      () =>
        service.createBulk(
          'survey-id',
          'version-id',
          {
            expectedUpdatedAt: '2026-07-31T23:59:59.000Z',
            questionIds: ['question-1', 'question-2'],
            rule: ruleInput(expectedUpdatedAt),
          },
          actor,
        ),
    ],
    [
      'update',
      () =>
        service.update(
          'survey-id',
          'version-id',
          'question-1',
          'rule-1',
          ruleInput('2026-07-31T23:59:59.000Z'),
          actor,
        ),
    ],
    [
      'delete',
      () =>
        service.remove(
          'survey-id',
          'version-id',
          'question-1',
          'rule-1',
          { expectedUpdatedAt: '2026-07-31T23:59:59.000Z' },
          actor,
        ),
    ],
    [
      'reorder',
      () =>
        service.reorder(
          'survey-id',
          'version-id',
          'question-1',
          {
            expectedUpdatedAt: '2026-07-31T23:59:59.000Z',
            ruleIds: ['rule-1'],
          },
          actor,
        ),
    ],
  ])('rejects stale revision before %s persistence', async (_label, mutate) => {
    let conflict: unknown;
    try {
      await mutate();
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(ConflictException);
    expect((conflict as ConflictException).getResponse()).toMatchObject({
      code: 'SURVEY_VERSION_EDIT_CONFLICT',
    });
    expect(manager.save).not.toHaveBeenCalled();
  });
});

function ruleInput(expectedUpdatedAt: string) {
  return {
    expectedUpdatedAt,
    groupOperator: ApplicabilityGroupOperator.All,
    action: ApplicabilityAction.Omit,
    defaultAction: ApplicabilityAction.Show,
    order: 0,
    conditions: [
      {
        feature: 'has_kiosk',
        operator: 'equals',
        expectedValue: true,
        order: 0,
      },
    ],
  };
}

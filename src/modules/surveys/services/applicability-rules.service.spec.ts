import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { UserRole } from '../../users/entities/user-role.enum';
import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
  SurveyApplicabilityRule,
} from '../entities/survey-applicability-rule.entity';
import { ApplicabilityEngine } from './applicability-engine.service';
import { ApplicabilityRulesService } from './applicability-rules.service';

describe('ApplicabilityRulesService bulk creation', () => {
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
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'assertDefaultAction' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'saveConditions' as never)
      .mockResolvedValue([] as never);
    jest
      .spyOn(service as never, 'audit' as never)
      .mockResolvedValue({} as never);
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

    expect(created).toHaveLength(2);
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
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Pregunta inválida') as never);

    await expect(
      service.createBulk(
        'survey-id',
        'version-id',
        {
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
});

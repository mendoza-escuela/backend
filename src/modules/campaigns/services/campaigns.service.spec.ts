import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SurveyVersionStatus } from '../../surveys/entities/survey-version-status.enum';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { CampaignStatus } from '../entities/campaign-status.enum';
import { CampaignSchool } from '../entities/campaign-school.entity';
import { CampaignType } from '../entities/campaign-type.enum';
import { Campaign } from '../entities/campaign.entity';
import { CampaignsService } from './campaigns.service';

describe('CampaignsService', () => {
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
  const version = {
    id: 'c1338ad3-ea47-44f4-b3f5-c5fc3f5f5fa6',
    surveyId: 'survey-id',
    versionNumber: 2,
    title: 'Versión publicada',
    status: SurveyVersionStatus.Published,
    publishedAt: new Date('2026-07-01T12:00:00.000Z'),
    survey: {
      id: 'survey-id',
      code: 'diagnostico',
      name: 'Diagnóstico',
      isActive: true,
    },
  } as SurveyVersion;

  const manager = {
    create: jest.fn(
      (_entity: unknown, attributes: Record<string, unknown>) => attributes,
    ),
    findOne: jest.fn(),
    count: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  } as unknown as DataSource;
  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CampaignsService(dataSource);
  });

  it('creates a draft associated with a published version and Mendoza end time', async () => {
    manager.findOne.mockResolvedValue(version);
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) =>
        entity === Campaign ? { ...attributes, id: 'campaign-id' } : attributes,
    );
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 'campaign-id' } as never);

    await service.create(
      {
        name: 'Diagnóstico anual 2026',
        description: null,
        type: CampaignType.Annual,
        surveyVersionId: version.id,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      },
      actor,
    );

    expect(manager.save).toHaveBeenCalledWith(
      Campaign,
      expect.objectContaining({
        status: CampaignStatus.Draft,
        surveyVersionId: version.id,
        startsAt: new Date('2026-08-01T03:00:00.000Z'),
        endsAt: new Date('2026-09-01T02:59:59.999Z'),
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      AuditLog,
      expect.objectContaining({
        action: 'CAMPAIGN_CREATED',
        actorUserId: actor.id,
      }),
    );
  });

  it('rejects campaign creation with a non-published version', async () => {
    manager.findOne.mockResolvedValue({
      ...version,
      status: SurveyVersionStatus.Draft,
      publishedAt: null,
    });

    await expect(
      service.create(
        {
          name: 'Diagnóstico anual 2026',
          type: CampaignType.Annual,
          surveyVersionId: version.id,
          startDate: '2026-08-01',
          endDate: '2026-08-31',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('does not allow an active campaign to return to draft', async () => {
    jest.spyOn(service, 'closeExpiredCampaigns').mockResolvedValue();
    manager.findOne.mockResolvedValue({
      id: 'campaign-id',
      status: CampaignStatus.Active,
    });

    await expect(
      service.setStatus('campaign-id', CampaignStatus.Draft, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not activate a campaign without assigned schools', async () => {
    jest.spyOn(service, 'closeExpiredCampaigns').mockResolvedValue();
    manager.findOne
      .mockResolvedValueOnce({
        id: 'campaign-id',
        status: CampaignStatus.Draft,
        surveyVersionId: version.id,
        endsAt: new Date('2026-12-31T23:59:59.999Z'),
      })
      .mockResolvedValueOnce(version);
    manager.count.mockResolvedValue(0);

    await expect(
      service.setStatus('campaign-id', CampaignStatus.Active, actor),
    ).rejects.toThrow('No se puede activar una etapa sin escuelas asignadas.');
    expect(manager.count).toHaveBeenCalledWith(
      CampaignSchool,
      expect.anything(),
    );
  });

  it('blocks an assigned stage until the previous assigned stage is submitted', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'stage-1',
          name: 'Diagnóstico inicial',
          cycle: 'programa 2026',
          sequenceOrder: '1',
          submissionStatus: 'draft',
        },
      ]),
    };
    const workflowManager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => queryBuilder),
      })),
    } as unknown as EntityManager;
    const current = {
      id: 'stage-2',
      name: 'Plan de mejora',
      workflowCycle: 'Programa 2026',
      sequenceOrder: 2,
    } as Campaign;

    const blockers = await service.workflowBlockers(
      [current],
      'school-id',
      workflowManager,
    );

    expect(blockers.get(current.id)).toEqual({
      id: 'stage-1',
      name: 'Diagnóstico inicial',
      sequenceOrder: 1,
    });
    await expect(
      service.assertWorkflowUnlocked(current, 'school-id', workflowManager),
    ).rejects.toThrow('Diagnóstico inicial');
  });

  it('ignores a previous stage once its submission was sent', async () => {
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'stage-1',
          name: 'Diagnóstico inicial',
          cycle: 'programa 2026',
          sequenceOrder: '1',
          submissionStatus: 'submitted',
        },
      ]),
    };
    const workflowManager = {
      getRepository: jest.fn(() => ({
        createQueryBuilder: jest.fn(() => queryBuilder),
      })),
    } as unknown as EntityManager;
    const current = {
      id: 'stage-2',
      workflowCycle: 'Programa 2026',
      sequenceOrder: 2,
    } as Campaign;

    await expect(
      service.assertWorkflowUnlocked(current, 'school-id', workflowManager),
    ).resolves.toBeUndefined();
  });
});

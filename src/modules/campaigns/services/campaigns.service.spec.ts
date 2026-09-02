import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { SurveyVersionStatus } from '../../surveys/entities/survey-version-status.enum';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import {
  SurveyVersionCertification,
  SurveyVersionCertificationService,
} from '../../surveys/services/survey-version-certification.service';
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
    getRepository: jest.fn(),
  };
  const versionCertification = {
    certify: jest.fn(),
  };
  let service: CampaignsService;

  beforeEach(() => {
    jest.clearAllMocks();
    versionCertification.certify.mockReturnValue(evaluable());
    service = new CampaignsService(
      dataSource as unknown as DataSource,
      versionCertification as unknown as SurveyVersionCertificationService,
    );
  });

  it('ofrece en el selector sólo versiones publicadas evaluables', async () => {
    const queryBuilder = publishedVersionsBuilder([
      { ...version, id: 'generic-version', dimensions: [] },
      { ...version, id: 'institutional-version', dimensions: [] },
    ] as SurveyVersion[]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: jest.fn(() => queryBuilder),
    });
    versionCertification.certify
      .mockReturnValueOnce({
        profile: 'generic',
        evaluable: false,
        evaluationErrors: ['No evaluable'],
      })
      .mockReturnValueOnce(evaluable());

    const options = await service.publishedVersionOptions();

    expect(options).toHaveLength(1);
    expect(options[0].id).toBe('institutional-version');
    expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
      'question.options',
      'option',
    );
  });

  it('acepta una versión archivada certificada para una etapa activa existente', async () => {
    const archived = {
      ...version,
      status: SurveyVersionStatus.Archived,
      survey: { ...version.survey, isActive: false },
    } as SurveyVersion;
    manager.findOne.mockResolvedValue(archived);

    await expect(
      service.assertVersionCertifiedForExistingCampaign(
        archived.id,
        manager as unknown as EntityManager,
      ),
    ).resolves.toBe(archived);
    expect(versionCertification.certify).toHaveBeenCalledWith(archived);
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

  it('rechaza crear una etapa con una versión publicada genérica', async () => {
    manager.findOne.mockResolvedValue(version);
    versionCertification.certify.mockReturnValue({
      profile: 'generic',
      evaluable: false,
      evaluationErrors: [
        'La versión es genérica y no puede utilizarse en campañas institucionales evaluables.',
      ],
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
    ).rejects.toMatchObject({
      response: {
        code: 'SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE',
      },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rechaza cambiar un borrador a una versión publicada no evaluable', async () => {
    manager.findOne
      .mockResolvedValueOnce({
        id: 'campaign-id',
        status: CampaignStatus.Draft,
        surveyVersionId: 'previous-version-id',
      })
      .mockResolvedValueOnce(version);
    versionCertification.certify.mockReturnValue({
      profile: 'generic',
      evaluable: false,
      evaluationErrors: ['No evaluable'],
    });

    await expect(
      service.update('campaign-id', { surveyVersionId: version.id }, actor),
    ).rejects.toMatchObject({
      response: {
        code: 'SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE',
      },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rechaza editar un borrador heredado si conserva una versión no evaluable', async () => {
    manager.findOne
      .mockResolvedValueOnce({
        id: 'campaign-id',
        status: CampaignStatus.Draft,
        surveyVersionId: version.id,
      })
      .mockResolvedValueOnce(version);
    versionCertification.certify.mockReturnValue({
      valid: true,
      errors: [],
      profile: 'generic',
      evaluable: false,
      evaluationErrors: ['No evaluable'],
    });

    await expect(
      service.update('campaign-id', { name: 'Nombre corregido' }, actor),
    ).rejects.toMatchObject({
      response: {
        code: 'SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE',
      },
    });
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

  it('rechaza activar una etapa heredada cuya versión dejó de ser evaluable', async () => {
    jest.spyOn(service, 'closeExpiredCampaigns').mockResolvedValue();
    manager.findOne
      .mockResolvedValueOnce({
        id: 'campaign-id',
        status: CampaignStatus.Draft,
        surveyVersionId: version.id,
        endsAt: new Date('2026-12-31T23:59:59.999Z'),
      })
      .mockResolvedValueOnce(version);
    versionCertification.certify.mockReturnValue({
      profile: 'institutional',
      evaluable: false,
      evaluationErrors: [
        'p038: la secuencia de puntajes aprobada es 100/66/33/0.',
      ],
    });

    await expect(
      service.setStatus('campaign-id', CampaignStatus.Active, actor),
    ).rejects.toMatchObject({
      response: {
        code: 'SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE',
      },
    });
    expect(manager.count).not.toHaveBeenCalled();
  });

  it('bloquea la operación de una campaña activa heredada no evaluable', async () => {
    manager.findOne.mockResolvedValue({
      id: 'legacy-campaign',
      status: CampaignStatus.Active,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60_000),
      surveyVersion: version,
    });
    versionCertification.certify.mockReturnValue({
      profile: 'generic',
      evaluable: false,
      evaluationErrors: ['No evaluable'],
    });

    await expect(
      service.assertOperational(
        'legacy-campaign',
        manager as unknown as EntityManager,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE',
      },
    });
  });

  it('bloquea una campaña activa corrupta que referencia una versión borrador', async () => {
    manager.findOne.mockResolvedValue({
      id: 'corrupt-campaign',
      status: CampaignStatus.Active,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60_000),
      surveyVersion: {
        ...version,
        status: SurveyVersionStatus.Draft,
        publishedAt: null,
      },
    });

    await expect(
      service.assertOperational(
        'corrupt-campaign',
        manager as unknown as EntityManager,
      ),
    ).rejects.toThrow('La versión asociada a la etapa no está disponible.');
    expect(versionCertification.certify).not.toHaveBeenCalled();
  });

  it('mantiene las campañas activas heredadas para que el portal pueda mostrarlas bloqueadas', async () => {
    jest.spyOn(service, 'closeExpiredCampaigns').mockResolvedValue();
    const incompatible = {
      id: 'legacy-campaign',
      surveyVersion: { ...version, dimensions: [] },
    } as unknown as Campaign;
    const compatible = {
      id: 'compatible-campaign',
      surveyVersion: { ...version, dimensions: [] },
    } as unknown as Campaign;
    const queryBuilder = operationalCampaignsBuilder([
      incompatible,
      compatible,
    ]);
    dataSource.getRepository.mockReturnValue({
      createQueryBuilder: jest.fn(() => queryBuilder),
    });
    const campaigns = await service.operationalCampaigns('school-id');

    expect(campaigns.map(({ id }) => id)).toEqual([
      'legacy-campaign',
      'compatible-campaign',
    ]);
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

function evaluable(): SurveyVersionCertification {
  return {
    valid: true,
    errors: [],
    profile: 'institutional',
    evaluable: true,
    evaluationErrors: [],
  };
}

function publishedVersionsBuilder(versions: SurveyVersion[]) {
  return {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(versions),
  };
}

function operationalCampaignsBuilder(campaigns: Campaign[]) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(campaigns),
  };
}

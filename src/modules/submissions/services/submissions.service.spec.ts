import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { CampaignType } from '../../campaigns/entities/campaign-type.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { CampaignsService } from '../../campaigns/services/campaigns.service';
import { School } from '../../schools/entities/school.entity';
import { SchoolsService } from '../../schools/services/schools.service';
import { SurveyQuestionType } from '../../surveys/entities/survey-question-type.enum';
import { SurveyVersionStatus } from '../../surveys/entities/survey-version-status.enum';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { SurveyAnswer } from '../entities/survey-answer.entity';
import { SurveySubmission } from '../entities/survey-submission.entity';
import { SubmissionsService } from './submissions.service';

describe('SubmissionsService', () => {
  const actor: AuthenticatedUser = {
    id: 'actor-id',
    firstName: 'Ana',
    lastName: 'Directora',
    email: 'escuela@example.com',
    role: UserRole.School,
    sessionId: 'session-id',
    mustChangePassword: false,
    lastLoginAt: null,
  };
  const school = {
    id: 'school-id',
    cue: '500000001',
    name: 'Escuela Uno',
    isActive: true,
  } as School;
  const campaign = {
    id: 'campaign-id',
    name: 'Diagnóstico anual',
    description: null,
    type: CampaignType.Annual,
    status: CampaignStatus.Active,
    surveyVersionId: 'version-id',
    startsAt: new Date('2026-01-01T03:00:00.000Z'),
    endsAt: new Date('2099-01-01T02:59:59.999Z'),
  } as Campaign;
  const manager = {
    create: jest.fn(
      (_entity: unknown, attributes: Record<string, unknown>) => attributes,
    ),
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  const dataSource = {
    manager: manager as unknown as EntityManager,
    transaction: jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  } as unknown as DataSource;
  const campaignsService = {
    operationalCampaigns: jest.fn(),
    assertOperational: jest.fn(),
  };
  const schoolsService = {
    evaluationContextForUser: jest.fn(),
    assertActiveForEvaluation: jest.fn(),
  };
  let service: SubmissionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SubmissionsService(
      dataSource,
      campaignsService as unknown as CampaignsService,
      schoolsService as unknown as SchoolsService,
    );
  });

  it('requires annual rectification before creating the first draft', async () => {
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        periodYear: 2026,
        isRectified: false,
        rectifiedAt: null,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne.mockResolvedValue(null);

    await expect(service.startOrGet(campaign.id, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('creates one school-owned draft and preserves the original respondent', async () => {
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        periodYear: 2026,
        isRectified: true,
        rectifiedAt: new Date(),
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne.mockResolvedValue(null);
    manager.save.mockImplementation(
      (entity: unknown, attributes: Record<string, unknown>) =>
        entity === SurveySubmission
          ? { ...attributes, id: 'submission-id' }
          : attributes,
    );
    jest
      .spyOn(service, 'workspace')
      .mockResolvedValue({ submission: { id: 'submission-id' } } as never);

    await service.startOrGet(campaign.id, actor);

    expect(manager.save).toHaveBeenCalledWith(
      SurveySubmission,
      expect.objectContaining({
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
      }),
    );
  });

  it('replaces the full draft with validated option references', async () => {
    const version = publishedVersion();
    const submission = {
      id: 'submission-id',
      campaignId: campaign.id,
      schoolId: school.id,
      surveyVersionId: version.id,
      status: 'draft',
      answers: [],
    } as unknown as SurveySubmission;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        periodYear: 2026,
        isRectified: true,
        rectifiedAt: new Date(),
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(version);
    manager.save.mockImplementation(
      (_entity: unknown, attributes: unknown) => attributes,
    );
    jest
      .spyOn(service, 'workspace')
      .mockResolvedValue({ submission: { id: submission.id } } as never);

    await service.saveDraft(
      campaign.id,
      {
        answers: [
          {
            questionId: 'c2c2d0f3-9638-4dcc-9989-a8ef2ceda2bb',
            optionId: '1a7ec566-e626-42bf-a128-6423c571a4db',
          },
        ],
      },
      actor,
    );

    expect(manager.delete).toHaveBeenCalledWith(SurveyAnswer, {
      submissionId: submission.id,
    });
    expect(manager.save).toHaveBeenCalledWith(
      SurveyAnswer,
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: submission.id,
          questionId: 'c2c2d0f3-9638-4dcc-9989-a8ef2ceda2bb',
          optionId: '1a7ec566-e626-42bf-a128-6423c571a4db',
        }),
      ]),
    );
    expect(manager.update).toHaveBeenCalledTimes(1);
    expect(manager.save).not.toHaveBeenCalledWith(
      SurveySubmission,
      expect.anything(),
    );
  });
});

function publishedVersion() {
  return {
    id: 'version-id',
    status: SurveyVersionStatus.Published,
    dimensions: [
      {
        id: 'dimension-id',
        code: 'compromiso_institucional',
        title: 'Compromiso',
        order: 0,
        sections: [
          {
            id: 'section-id',
            code: 'general',
            title: 'General',
            order: 0,
            questions: [
              {
                id: 'c2c2d0f3-9638-4dcc-9989-a8ef2ceda2bb',
                code: 'p001',
                type: SurveyQuestionType.SingleChoice,
                prompt: '¿Cuenta con un compromiso?',
                required: true,
                order: 0,
                validation: {},
                options: [
                  {
                    id: '1a7ec566-e626-42bf-a128-6423c571a4db',
                    value: 'si',
                    label: 'Sí',
                    score: 100,
                    order: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as SurveyVersion;
}

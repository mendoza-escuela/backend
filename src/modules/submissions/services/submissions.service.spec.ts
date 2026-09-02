import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, FindOperator } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { CampaignType } from '../../campaigns/entities/campaign-type.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { CampaignsService } from '../../campaigns/services/campaigns.service';
import { CampaignSchoolsService } from '../../campaigns/services/campaign-schools.service';
import { EvaluationResultsService } from '../../evaluation/services/evaluation-results.service';
import { School } from '../../schools/entities/school.entity';
import { SchoolsService } from '../../schools/services/schools.service';
import { SurveyQuestionType } from '../../surveys/entities/survey-question-type.enum';
import type { SurveyQuestionValidation } from '../../surveys/entities/survey-question.entity';
import { SurveyVersionStatus } from '../../surveys/entities/survey-version-status.enum';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { SurveyApplicabilityService } from '../../surveys/services/survey-applicability.service';
import { SurveyVersionCertificationService } from '../../surveys/services/survey-version-certification.service';
import { UserRole } from '../../users/entities/user-role.enum';
import { SurveyAnswer } from '../entities/survey-answer.entity';
import { SubmissionQuestionApplicability } from '../entities/submission-question-applicability.entity';
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
    find: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  const submissionRepository = {
    find: jest.fn(),
    findOneBy: jest.fn(),
  };
  const dataSource = {
    manager: manager as unknown as EntityManager,
    getRepository: jest.fn(() => submissionRepository),
    transaction: jest.fn(
      (callback: (entityManager: EntityManager) => Promise<unknown>) =>
        callback(manager as unknown as EntityManager),
    ),
  };
  const campaignsService = {
    operationalCampaigns: jest.fn(),
    assertOperational: jest.fn(),
    workflowBlockers: jest.fn(),
    assertWorkflowUnlocked: jest.fn(),
  };
  const campaignSchoolsService = {
    assertAssigned: jest.fn(),
  };
  const schoolsService = {
    evaluationContextForUser: jest.fn(),
    assertActiveForEvaluation: jest.fn(),
  };
  const surveyApplicability = {
    evaluate: jest.fn(),
    result: jest.fn(),
  };
  const evaluationResults = {
    calculateAndPersist: jest.fn(),
  };
  const versionCertification = {
    certify: jest.fn(),
  };
  let service: SubmissionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    manager.findOne.mockReset();
    manager.find.mockReset();
    submissionRepository.find.mockReset();
    submissionRepository.findOneBy.mockReset();
    campaignsService.workflowBlockers.mockResolvedValue(new Map());
    campaignsService.assertWorkflowUnlocked.mockResolvedValue(undefined);
    versionCertification.certify.mockReturnValue({
      valid: true,
      errors: [],
      profile: 'institutional',
      evaluable: true,
      evaluationErrors: [],
    });
    service = new SubmissionsService(
      dataSource as unknown as DataSource,
      campaignsService as unknown as CampaignsService,
      campaignSchoolsService as unknown as CampaignSchoolsService,
      schoolsService as unknown as SchoolsService,
      surveyApplicability as unknown as SurveyApplicabilityService,
      evaluationResults as unknown as EvaluationResultsService,
      versionCertification as unknown as SurveyVersionCertificationService,
    );
  });

  function arrangeDraftQuestion({
    type,
    required = false,
    validation = {},
  }: {
    type: SurveyQuestionType;
    required?: boolean;
    validation?: SurveyQuestionValidation;
  }) {
    const version = publishedVersion();
    const question = version.dimensions[0].sections[0].questions[0];
    question.type = type;
    question.required = required;
    question.validation = validation;
    if (type !== SurveyQuestionType.SingleChoice) question.options = [];
    const submission = {
      ...workspaceSubmission(version, schoolSnapshot(), 'draft', []),
      campaign,
      answers: [],
    };
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: submission.schoolRectificationId,
        isEvaluationReady: true,
        snapshot: submission.schoolProfileSnapshot,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([question.id]),
    );
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission);
    manager.find.mockImplementation((entity: unknown) =>
      Promise.resolve(entity === SurveyAnswer ? submission.answers : []),
    );
    manager.save.mockImplementation(
      (_entity: unknown, attributes: unknown) => attributes,
    );
    return { question, submission, version };
  }

  it('requires annual rectification before creating the first draft', async () => {
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: null,
        periodYear: 2026,
        isConfirmed: false,
        isEvaluationReady: false,
        missingFields: [],
        isRectified: false,
        rectifiedAt: null,
        snapshot: null,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne.mockResolvedValue(null);

    await expect(service.startOrGet(campaign.id, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('explica que una ficha confirmada incompleta requiere actualización', async () => {
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'rectification-id',
        periodYear: 2026,
        isConfirmed: true,
        isEvaluationReady: false,
        missingFields: [
          { code: 'hasKiosk', label: 'Kiosco' },
          {
            code: 'hasFoodService',
            label: 'Comedor o servicio alimentario',
          },
        ],
        isRectified: false,
        rectifiedAt: new Date('2026-08-10T12:00:00.000Z'),
        snapshot: schoolSnapshot(),
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne.mockResolvedValue(null);

    await expect(service.startOrGet(campaign.id, actor)).rejects.toThrow(
      'La ficha escolar fue confirmada para 2026, pero requiere actualización antes de comenzar. Datos pendientes: Kiosco, Comedor o servicio alimentario.',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it.each([
    {
      isConfirmed: false,
      isEvaluationReady: false,
      expected:
        'Debés confirmar la ficha institucional anual antes de comenzar.',
    },
    {
      isConfirmed: true,
      isEvaluationReady: false,
      expected:
        'La ficha anual está confirmada, pero requiere actualización antes de comenzar.',
    },
    {
      isConfirmed: true,
      isEvaluationReady: true,
      expected: null,
    },
  ])(
    'informa el bloqueo correcto con confirmación=$isConfirmed y aptitud=$isEvaluationReady',
    ({ isConfirmed, isEvaluationReady, expected }) => {
      const blockingReason = (
        service as unknown as {
          blockingReason: (
            active: boolean,
            confirmed: boolean,
            ready: boolean,
          ) => string | null;
        }
      ).blockingReason(true, isConfirmed, isEvaluationReady);

      expect(blockingReason).toBe(expected);
    },
  );

  it('lists expired drafts separately, including drafts whose assignment was removed', async () => {
    const expiredVersion = workspaceVersion();
    const expiredDraft = workspaceSubmission(
      expiredVersion,
      schoolSnapshot(),
      'draft',
      [],
    );
    Object.assign(expiredDraft.campaign, {
      status: CampaignStatus.Closed,
      startsAt: new Date('2025-01-01T00:00:00.000Z'),
      endsAt: new Date('2025-12-31T23:59:59.999Z'),
    });
    expiredDraft.answers = [
      {
        submissionId: expiredDraft.id,
        questionId: expiredVersion.dimensions[0].sections[0].questions[0].id,
      } as SurveyAnswer,
    ];

    const futureDraft = workspaceSubmission(
      expiredVersion,
      schoolSnapshot(),
      'draft',
      [],
    );
    Object.assign(futureDraft.campaign, {
      id: 'future-campaign-id',
      status: CampaignStatus.Closed,
      startsAt: new Date('2098-01-01T00:00:00.000Z'),
      endsAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    const submitted = workspaceSubmission(
      expiredVersion,
      schoolSnapshot(),
      'submitted',
      [],
    );
    Object.assign(submitted.campaign, {
      id: 'submitted-campaign-id',
      status: CampaignStatus.Archived,
      startsAt: new Date('2024-01-01T00:00:00.000Z'),
      endsAt: new Date('2024-12-31T23:59:59.999Z'),
    });

    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        isConfirmed: true,
        isEvaluationReady: true,
      },
    });
    campaignsService.operationalCampaigns.mockResolvedValue([campaign]);
    submissionRepository.find
      .mockResolvedValueOnce([expiredDraft, futureDraft, submitted])
      .mockResolvedValueOnce([]);
    manager.find
      .mockResolvedValueOnce(expiredDraft.answers)
      .mockResolvedValueOnce([]);
    const internals = service as unknown as {
      questionCounts: (versionIds: string[]) => Promise<Map<string, number>>;
    };
    jest
      .spyOn(internals, 'questionCounts')
      .mockResolvedValue(new Map([[expiredVersion.id, 1]]));

    const response = await service.availableCampaigns(actor);

    expect(submissionRepository.find).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { schoolId: school.id, status: 'draft' },
        relations: {
          campaign: { surveyVersion: { survey: true } },
        },
      }),
    );
    expect(manager.find).toHaveBeenCalledTimes(2);
    expect(response.expiredDrafts).toHaveLength(1);
    const [historicalSummary] = response.expiredDrafts;
    expect(historicalSummary.id).toBe(expiredDraft.campaignId);
    expect(historicalSummary.status).toBe(CampaignStatus.Closed);
    expect(historicalSummary.canStart).toBe(false);
    expect(historicalSummary.readOnly).toBe(true);
    expect(historicalSummary.blockingReason).toContain('sólo lectura');
    expect(historicalSummary.submission.id).toBe(expiredDraft.id);
    expect(historicalSummary.submission.status).toBe('draft');
    expect(historicalSummary.submission.progress).toEqual({
      answered: 1,
      total: 1,
      percentage: 100,
    });
  });

  it('mantiene visible y bloqueada una etapa activa que referencia una versión borrador corrupta', async () => {
    const corruptVersion = workspaceVersion();
    corruptVersion.status = SurveyVersionStatus.Draft;
    corruptVersion.publishedAt = null;
    const activeCampaign = {
      ...campaign,
      surveyVersion: corruptVersion,
    };
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        isConfirmed: true,
        isEvaluationReady: true,
      },
    });
    campaignsService.operationalCampaigns.mockResolvedValue([activeCampaign]);
    submissionRepository.find.mockResolvedValue([]);
    jest
      .spyOn(
        service as unknown as {
          questionCounts: (
            versionIds: string[],
          ) => Promise<Map<string, number>>;
        },
        'questionCounts',
      )
      .mockResolvedValue(new Map([[activeCampaign.surveyVersionId, 1]]));

    const response = await service.availableCampaigns(actor);

    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      canStart: false,
      workflowStatus: 'locked',
      blockedBy: null,
    });
    expect(response.items[0].blockingReason).toContain(
      'no es evaluable institucionalmente',
    );
    expect(versionCertification.certify).not.toHaveBeenCalled();
  });

  it('creates one school-owned draft and preserves the original respondent', async () => {
    const schoolSnapshot = {
      name: school.name,
      cue: school.cue,
      directorName: 'Ana',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Primario',
      shift: 'Simple',
      hasKiosk: false,
    };
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'rectification-id',
        periodYear: 2026,
        isConfirmed: true,
        isEvaluationReady: true,
        missingFields: [],
        isRectified: true,
        rectifiedAt: new Date(),
        snapshot: schoolSnapshot,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(publishedVersion());
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

    expect(schoolsService.assertActiveForEvaluation).toHaveBeenCalledWith(
      school.id,
      manager,
    );
    expect(manager.save).toHaveBeenCalledWith(
      SurveySubmission,
      expect.objectContaining({
        campaignId: campaign.id,
        schoolId: school.id,
        surveyVersionId: campaign.surveyVersionId,
        schoolRectificationId: 'rectification-id',
        schoolProfileSnapshot: schoolSnapshot,
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

  it('replaces only applicable answers with validated option references', async () => {
    const version = publishedVersion();
    const submission = {
      id: 'submission-id',
      campaignId: campaign.id,
      schoolId: school.id,
      surveyVersionId: version.id,
      status: 'draft',
      revision: 0,
      answers: [],
    } as unknown as SurveySubmission;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'rectification-id',
        periodYear: 2026,
        isConfirmed: true,
        isEvaluationReady: true,
        missingFields: [],
        isRectified: true,
        rectifiedAt: new Date(),
        snapshot: {
          name: school.name,
          cue: school.cue,
          directorName: 'Ana',
          address: 'Calle 1',
          locality: 'Mendoza',
          scope: 'Urbano',
          educationLevel: 'Primario',
          shift: 'Simple',
        },
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor(['c2c2d0f3-9638-4dcc-9989-a8ef2ceda2bb']),
    );
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(version);
    manager.save.mockImplementation(
      (_entity: unknown, attributes: unknown) => attributes,
    );
    const workspaceSpy = jest
      .spyOn(service, 'workspace')
      .mockResolvedValue({ submission: { id: submission.id } } as never);

    const saved = await service.saveDraft(
      campaign.id,
      {
        expectedRevision: 0,
        answers: [
          {
            questionId: 'c2c2d0f3-9638-4dcc-9989-a8ef2ceda2bb',
            optionId: '1a7ec566-e626-42bf-a128-6423c571a4db',
          },
        ],
      },
      actor,
    );

    const deleteCalls = manager.delete.mock.calls as unknown as Array<
      [unknown, unknown]
    >;
    expect(deleteCalls.some(([entity]) => entity === SurveyAnswer)).toBe(true);
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
    expect(manager.update).toHaveBeenCalledWith(
      SurveySubmission,
      submission.id,
      expect.objectContaining({
        lastSavedAt: submission.lastSavedAt,
        revision: 1,
      }),
    );
    expect(manager.save).not.toHaveBeenCalledWith(
      SurveySubmission,
      expect.anything(),
    );
    expect(saved.submission.revision).toBe(1);
    expect(workspaceSpy).not.toHaveBeenCalled();
  });

  it('accepts an empty optional text answer even when it has minLength', async () => {
    const version = publishedVersion();
    const question = version.dimensions[0].sections[0].questions[0];
    question.type = SurveyQuestionType.ShortText;
    question.required = false;
    question.validation = { minLength: 5 };
    question.options = [];
    const submission = {
      ...workspaceSubmission(version, schoolSnapshot(), 'draft', []),
      campaign,
      answers: [],
    };
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: submission.schoolRectificationId,
        isEvaluationReady: true,
        snapshot: submission.schoolProfileSnapshot,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([question.id]),
    );
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission);
    manager.find.mockResolvedValue([]);

    await expect(
      service.saveDraft(
        campaign.id,
        {
          expectedRevision: 0,
          answers: [{ questionId: question.id, value: '   ' }],
        },
        actor,
      ),
    ).resolves.toMatchObject({ submission: { revision: 1 } });

    expect(
      manager.save.mock.calls.some(([entity]) => entity === SurveyAnswer),
    ).toBe(false);
  });

  it('rejects padded text whose normalized value is shorter than minLength', async () => {
    const { question } = arrangeDraftQuestion({
      type: SurveyQuestionType.ShortText,
      validation: { minLength: 5 },
    });

    await expect(
      service.saveDraft(
        campaign.id,
        {
          expectedRevision: 0,
          answers: [{ questionId: question.id, value: '  abc  ' }],
        },
        actor,
      ),
    ).rejects.toThrow(`La respuesta ${question.code} es demasiado corta.`);

    expect(
      manager.save.mock.calls.some(([entity]) => entity === SurveyAnswer),
    ).toBe(false);
  });

  it('does not count padding against maxLength and persists normalized text', async () => {
    const { question } = arrangeDraftQuestion({
      type: SurveyQuestionType.ShortText,
      validation: { maxLength: 5 },
    });

    const saved = await service.saveDraft(
      campaign.id,
      {
        expectedRevision: 0,
        answers: [{ questionId: question.id, value: '  abcde  ' }],
      },
      actor,
    );

    expect(manager.save).toHaveBeenCalledWith(
      SurveyAnswer,
      expect.arrayContaining([
        expect.objectContaining({
          questionId: question.id,
          value: 'abcde',
        }),
      ]),
    );
    expect(saved.answers).toEqual({ [question.id]: 'abcde' });
  });

  it('normalizes a padded date before validating and persisting it', async () => {
    const { question } = arrangeDraftQuestion({
      type: SurveyQuestionType.Date,
      validation: { minLength: 10, maxLength: 10 },
    });

    const saved = await service.saveDraft(
      campaign.id,
      {
        expectedRevision: 0,
        answers: [{ questionId: question.id, value: '  2026-09-01  ' }],
      },
      actor,
    );

    expect(manager.save).toHaveBeenCalledWith(
      SurveyAnswer,
      expect.arrayContaining([
        expect.objectContaining({
          questionId: question.id,
          value: '2026-09-01',
        }),
      ]),
    );
    expect(saved.answers).toEqual({ [question.id]: '2026-09-01' });
  });

  it.each(['saveDraft', 'submit'] as const)(
    'rejects stale %s writes without changing persisted answers',
    async (operation) => {
      const version = publishedVersion();
      const submission = {
        id: 'submission-id',
        campaignId: campaign.id,
        schoolId: school.id,
        surveyVersionId: version.id,
        status: 'draft',
        revision: 4,
        answers: [],
        applicabilityDecisions: [],
      } as unknown as SurveySubmission;
      schoolsService.evaluationContextForUser.mockResolvedValue({
        school,
        rectification: { isRectified: true },
      });
      campaignsService.assertOperational.mockResolvedValue(campaign);
      manager.findOne
        .mockResolvedValueOnce(submission)
        .mockResolvedValueOnce(submission);
      manager.find.mockResolvedValue([]);

      const request =
        operation === 'saveDraft'
          ? service.saveDraft(
              campaign.id,
              { expectedRevision: 3, answers: [] },
              actor,
            )
          : service.submit(campaign.id, { expectedRevision: 3 }, actor);

      await expect(request).rejects.toMatchObject({
        response: {
          code: 'SUBMISSION_REVISION_CONFLICT',
          currentRevision: 4,
        },
      });
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(surveyApplicability.evaluate).not.toHaveBeenCalled();
    },
  );

  it.each(['saveDraft', 'submit'] as const)(
    'rejects %s when the persisted submission belongs to another campaign version',
    async (operation) => {
      const submission = {
        id: 'submission-id',
        campaignId: campaign.id,
        schoolId: school.id,
        surveyVersionId: 'another-version-id',
        status: 'draft',
        answers: [],
        applicabilityDecisions: [],
      } as unknown as SurveySubmission;
      schoolsService.evaluationContextForUser.mockResolvedValue({
        school,
        rectification: { isRectified: true },
      });
      campaignsService.assertOperational.mockResolvedValue(campaign);
      manager.findOne.mockResolvedValue(submission);
      manager.find.mockResolvedValue([]);

      await expect(
        operation === 'saveDraft'
          ? service.saveDraft(
              campaign.id,
              { expectedRevision: 0, answers: [] },
              actor,
            )
          : service.submit(campaign.id, { expectedRevision: 0 }, actor),
      ).rejects.toMatchObject({
        response: {
          code: 'SURVEY_VERSION_NOT_INSTITUTIONALLY_EVALUABLE',
          errors: [
            'La versión persistida en la presentación no coincide con la versión de su etapa.',
          ],
        },
      });
      expect(surveyApplicability.evaluate).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    },
  );

  it('preserves a previous answer when its question becomes excluded', async () => {
    const version = publishedVersion();
    const applicableQuestionId =
      version.dimensions[0].sections[0].questions[0].id;
    const excludedQuestion = {
      ...version.dimensions[0].sections[0].questions[0],
      id: '92db0791-78a1-4617-b31a-071a417320cd',
      code: 'p002',
      options: [
        {
          ...version.dimensions[0].sections[0].questions[0].options[0],
          id: '0bc15d44-4609-45d4-90f2-3a2dd72a8188',
        },
      ],
    };
    version.dimensions[0].sections[0].questions.push(excludedQuestion);
    const submission = {
      id: 'submission-id',
      campaignId: campaign.id,
      schoolId: school.id,
      surveyVersionId: version.id,
      schoolProfileSnapshot: schoolSnapshot(),
      status: 'draft',
      revision: 0,
      answers: [
        {
          questionId: excludedQuestion.id,
          optionId: excludedQuestion.options[0].id,
        },
      ],
      applicabilityDecisions: [],
    } as unknown as SurveySubmission;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: { isRectified: true },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([applicableQuestionId], [excludedQuestion.id]),
    );
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(version);
    manager.save.mockImplementation(
      (_entity: unknown, attributes: unknown) => attributes,
    );
    jest.spyOn(service, 'workspace').mockResolvedValue({} as never);

    await service.saveDraft(
      campaign.id,
      {
        expectedRevision: 0,
        answers: [
          {
            questionId: applicableQuestionId,
            optionId:
              version.dimensions[0].sections[0].questions[0].options[0].id,
          },
        ],
      },
      actor,
    );

    const deleteCalls = manager.delete.mock.calls as unknown as Array<
      [unknown, unknown]
    >;
    const answerDeletion = deleteCalls.find(
      ([entity]) => entity === SurveyAnswer,
    );
    expect(answerDeletion).toBeDefined();
    const criteria = answerDeletion?.[1] as {
      questionId: FindOperator<string>;
    };
    expect(criteria.questionId.value).toEqual([applicableQuestionId]);
    expect(criteria.questionId.value).not.toContain(excludedQuestion.id);
  });

  it('rejects a new answer for an excluded question', async () => {
    const version = publishedVersion();
    const questionId = version.dimensions[0].sections[0].questions[0].id;
    const submission = {
      id: 'submission-id',
      campaignId: campaign.id,
      schoolId: school.id,
      surveyVersionId: version.id,
      schoolProfileSnapshot: schoolSnapshot(),
      status: 'draft',
      revision: 0,
      answers: [],
      applicabilityDecisions: [],
    } as unknown as SurveySubmission;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: { isRectified: true },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([], [questionId]),
    );
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(version);

    await expect(
      service.saveDraft(
        campaign.id,
        {
          expectedRevision: 0,
          answers: [
            {
              questionId,
              optionId:
                version.dimensions[0].sections[0].questions[0].options[0].id,
            },
          ],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignores an in-flight answer that becomes excluded by the rectification adopted in the same save', async () => {
    const version = workspaceVersion();
    const question = version.dimensions[0].sections[0].questions[0];
    const previousApplicability = applicabilityFor([question.id]);
    const submission = workspaceSubmission(
      version,
      { ...schoolSnapshot(), hasKiosk: true },
      'draft',
      previousApplicability.decisions,
    );
    submission.schoolRectificationId = 'rectification-previous';
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'rectification-current',
        isEvaluationReady: true,
        snapshot: { ...schoolSnapshot(), hasKiosk: false },
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([], [question.id]),
    );
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission);
    manager.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(previousApplicability.decisions);
    manager.save.mockImplementation(
      (_entity: unknown, attributes: unknown) => attributes,
    );

    const saved = await service.saveDraft(
      campaign.id,
      {
        expectedRevision: 0,
        answers: [
          {
            questionId: question.id,
            optionId: question.options[0].id,
          },
        ],
      },
      actor,
    );

    expect(saved).toMatchObject({
      submission: { revision: 1 },
      answers: {},
      survey: { version: { dimensions: [] } },
    });
    expect(
      manager.save.mock.calls.some(([entity]) => entity === SurveyAnswer),
    ).toBe(false);
  });

  it('does not expose a presentation owned by another school', async () => {
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: { ...school, id: 'another-school-id' },
      rectification: { isRectified: true },
    });
    manager.findOne.mockResolvedValue(null);

    await expect(service.workspace(campaign.id, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('blocks an inactive workspace before refreshing or recalculating its draft', async () => {
    const inactiveSchool = { ...school, isActive: false } as School;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school: inactiveSchool,
      rectification: {
        id: 'rectification-id',
        isRectified: true,
        snapshot: schoolSnapshot(),
      },
    });
    schoolsService.assertActiveForEvaluation.mockRejectedValueOnce(
      new ConflictException(
        'El colegio está inactivo y no puede realizar cargas ni evaluaciones.',
      ),
    );

    await expect(service.workspace(campaign.id, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(schoolsService.assertActiveForEvaluation).toHaveBeenCalledWith(
      inactiveSchool.id,
      manager,
    );
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(manager.find).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(surveyApplicability.evaluate).not.toHaveBeenCalled();
    expect(surveyApplicability.result).not.toHaveBeenCalled();
  });

  it('loads workspace collections with separate queries to avoid cartesian growth', async () => {
    const submission = workspaceSubmission(
      workspaceVersion(),
      schoolSnapshot(),
      'submitted',
      [],
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: { isRectified: true },
    });
    manager.findOne.mockResolvedValue(submission);
    manager.find.mockResolvedValue([]);
    surveyApplicability.evaluate.mockReturnValue(applicabilityFor([]));

    await service.workspace(campaign.id, actor);

    expect(manager.find).toHaveBeenCalledWith(
      SurveyAnswer,
      expect.objectContaining({ where: { submissionId: submission.id } }),
    );
    expect(manager.find).toHaveBeenCalledWith(
      SubmissionQuestionApplicability,
      expect.objectContaining({ where: { submissionId: submission.id } }),
    );
  });

  it('recalculates a reopened draft after adopting a newer rectification', async () => {
    const version = workspaceVersion();
    const linkedSnapshot = schoolSnapshot();
    const updatedSnapshot = { ...linkedSnapshot, hasKiosk: true };
    const submission = workspaceSubmission(
      version,
      linkedSnapshot,
      'draft',
      [],
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'new-rectification-id',
        isConfirmed: true,
        isEvaluationReady: true,
        missingFields: [],
        isRectified: true,
        snapshot: updatedSnapshot,
      },
    });
    manager.findOne.mockResolvedValue(submission);
    manager.save.mockImplementation(
      (_entity: unknown, attributes: unknown) => attributes,
    );
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([version.dimensions[0].sections[0].questions[0].id]),
    );

    await service.workspace(campaign.id, actor);
    await service.workspace(campaign.id, actor);

    expect(surveyApplicability.evaluate).toHaveBeenCalledTimes(2);
    expect(surveyApplicability.evaluate).toHaveBeenNthCalledWith(
      1,
      version,
      updatedSnapshot,
    );
    expect(surveyApplicability.evaluate).toHaveBeenNthCalledWith(
      2,
      version,
      updatedSnapshot,
    );
    expect(submission.schoolRectificationId).toBe('new-rectification-id');
    expect(submission.schoolProfileSnapshot).toEqual(updatedSnapshot);
    expect(manager.delete).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(
      SurveySubmission,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('does not rewrite unchanged applicability decisions while opening a draft', async () => {
    const version = workspaceVersion();
    const applicability = applicabilityFor([
      version.dimensions[0].sections[0].questions[0].id,
    ]);
    const submission = workspaceSubmission(
      version,
      schoolSnapshot(),
      'draft',
      applicability.decisions,
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: submission.schoolRectificationId,
        isRectified: true,
        snapshot: submission.schoolProfileSnapshot,
      },
    });
    manager.findOne.mockResolvedValue(submission);
    surveyApplicability.evaluate.mockReturnValue({
      ...applicability,
      evaluatedAt: new Date(applicability.evaluatedAt.getTime() + 1_000),
      decisions: applicability.decisions.map((decision) => ({
        ...decision,
        evaluatedAt: new Date(decision.evaluatedAt.getTime() + 1_000),
      })),
    });

    await service.workspace(campaign.id, actor);

    expect(manager.delete).not.toHaveBeenCalledWith(
      SubmissionQuestionApplicability,
      expect.anything(),
    );
  });

  it('uses persisted applicability for a historical submission', async () => {
    const version = workspaceVersion();
    const decision = applicabilityFor([
      version.dimensions[0].sections[0].questions[0].id,
    ]).decisions[0];
    const submission = workspaceSubmission(
      version,
      schoolSnapshot(),
      'submitted',
      [decision],
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'new-rectification-id',
        isRectified: true,
        snapshot: { ...schoolSnapshot(), hasKiosk: true },
      },
    });
    manager.findOne.mockResolvedValue(submission);
    surveyApplicability.result.mockReturnValue(
      applicabilityFor([version.dimensions[0].sections[0].questions[0].id]),
    );

    await service.workspace(campaign.id, actor);

    expect(surveyApplicability.result).toHaveBeenCalled();
    expect(surveyApplicability.evaluate).not.toHaveBeenCalled();
  });

  it('opens an expired draft from stored applicability without mutating historical data', async () => {
    const version = workspaceVersion();
    const storedDecision = applicabilityFor([
      version.dimensions[0].sections[0].questions[0].id,
    ]).decisions[0];
    const submission = workspaceSubmission(version, schoolSnapshot(), 'draft', [
      storedDecision,
    ]);
    Object.assign(submission.campaign, {
      status: CampaignStatus.Closed,
      endsAt: new Date('2025-12-31T23:59:59.999Z'),
    });
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'new-rectification-id',
        isConfirmed: true,
        isEvaluationReady: true,
        snapshot: { ...schoolSnapshot(), hasKiosk: true },
      },
    });
    manager.findOne.mockResolvedValue(submission);
    manager.find.mockImplementation((entity: unknown) =>
      Promise.resolve(
        entity === SubmissionQuestionApplicability ? [storedDecision] : [],
      ),
    );
    surveyApplicability.result.mockReturnValue(
      applicabilityFor([version.dimensions[0].sections[0].questions[0].id]),
    );

    const response = await service.workspace(campaign.id, actor);

    expect(response.submission.editable).toBe(false);
    expect(response.submission.blockingReason).toContain(
      'ya no se encuentra abierta',
    );
    expect(surveyApplicability.result).toHaveBeenCalled();
    expect(surveyApplicability.evaluate).not.toHaveBeenCalled();
    const writeLockCalls = manager.findOne.mock.calls.filter(
      ([entity, options]: [unknown, { lock?: unknown }]) =>
        entity === SurveySubmission && Boolean(options.lock),
    );
    expect(writeLockCalls).toHaveLength(0);
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('abre un borrador activo incompatible en modo de sólo lectura', async () => {
    const version = workspaceVersion();
    const submission = workspaceSubmission(
      version,
      schoolSnapshot(),
      'draft',
      [],
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: submission.schoolRectificationId,
        isConfirmed: true,
        isEvaluationReady: true,
        snapshot: submission.schoolProfileSnapshot,
      },
    });
    manager.findOne.mockResolvedValue(submission);
    manager.find.mockResolvedValue([]);
    versionCertification.certify.mockReturnValue({
      valid: false,
      errors: ['Versión incompatible.'],
      profile: 'institutional',
      evaluable: false,
      evaluationErrors: ['Versión incompatible.'],
    });
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([version.dimensions[0].sections[0].questions[0].id]),
    );

    const response = await service.workspace(campaign.id, actor);

    expect(response.submission.editable).toBe(false);
    expect(response.submission.canSubmit).toBe(false);
    expect(response.submission.blockingReason).toContain(
      'no es evaluable institucionalmente',
    );
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('reconstructs an expired draft in memory when it has no stored applicability', async () => {
    const version = workspaceVersion();
    const submission = workspaceSubmission(
      version,
      schoolSnapshot(),
      'draft',
      [],
    );
    Object.assign(submission.campaign, {
      status: CampaignStatus.Archived,
      endsAt: new Date('2025-12-31T23:59:59.999Z'),
    });
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'new-rectification-id',
        isConfirmed: true,
        isEvaluationReady: true,
        snapshot: { ...schoolSnapshot(), hasKiosk: true },
      },
    });
    manager.findOne.mockResolvedValue(submission);
    manager.find.mockResolvedValue([]);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([version.dimensions[0].sections[0].questions[0].id]),
    );

    const response = await service.workspace(campaign.id, actor);

    expect(surveyApplicability.evaluate).toHaveBeenCalledWith(
      version,
      submission.schoolProfileSnapshot,
    );
    expect(response.applicability.source).toBe('reconstructed');
    expect(response.submission.schoolRectificationId).toBe('rectification-id');
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('blocks final submission while applicability has missing school data', async () => {
    const version = publishedVersion();
    const submission = {
      id: 'submission-id',
      campaignId: campaign.id,
      schoolId: school.id,
      surveyVersionId: version.id,
      schoolProfileSnapshot: schoolSnapshot(),
      status: 'draft',
      revision: 0,
      answers: [],
      applicabilityDecisions: [],
    } as unknown as SurveySubmission;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: { isRectified: true },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(version);
    surveyApplicability.evaluate.mockReturnValue({
      ...applicabilityFor([]),
      status: 'incomplete',
      incompleteQuestionIds: new Set([
        version.dimensions[0].sections[0].questions[0].id,
      ]),
      missingFields: [{ code: 'has_kiosk', label: 'Tiene kiosco' }],
    });

    await expect(
      service.submit(campaign.id, { expectedRevision: 0 }, actor),
    ).rejects.toThrow('Tiene kiosco');
    expect(evaluationResults.calculateAndPersist).not.toHaveBeenCalled();
  });

  it('persists the result using only the resolved applicability on final submission', async () => {
    const version = publishedVersion();
    const applicableQuestion = version.dimensions[0].sections[0].questions[0];
    const excludedQuestion = {
      ...applicableQuestion,
      id: '92db0791-78a1-4617-b31a-071a417320cd',
      code: 'p002',
      options: [
        {
          ...applicableQuestion.options[0],
          id: '0bc15d44-4609-45d4-90f2-3a2dd72a8188',
        },
      ],
    };
    version.dimensions[0].sections[0].questions.push(excludedQuestion);
    const snapshot = schoolSnapshot();
    const submission = {
      id: 'submission-id',
      campaignId: campaign.id,
      schoolId: school.id,
      surveyVersionId: version.id,
      schoolRectificationId: 'rectification-id',
      schoolProfileSnapshot: snapshot,
      status: 'draft',
      revision: 0,
      answers: [
        {
          questionId: applicableQuestion.id,
          optionId: applicableQuestion.options[0].id,
        },
      ],
      applicabilityDecisions: [],
      originalRespondentSnapshot: {
        id: actor.id,
        firstName: actor.firstName,
        lastName: actor.lastName,
        email: actor.email,
      },
    } as unknown as SurveySubmission;
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: 'rectification-id',
        isRectified: true,
        snapshot,
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
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([applicableQuestion.id], [excludedQuestion.id]),
    );
    evaluationResults.calculateAndPersist.mockResolvedValue({
      id: 'result-id',
      generalScore: '100',
      algorithmVersion: 'test-v1',
    });
    jest.spyOn(service, 'workspace').mockResolvedValue({} as never);

    await service.submit(campaign.id, { expectedRevision: 0 }, actor);

    expect(surveyApplicability.evaluate).toHaveBeenCalledWith(
      version,
      snapshot,
    );
    expect(manager.findOne).toHaveBeenNthCalledWith(
      1,
      SurveySubmission,
      expect.objectContaining({
        where: {
          campaignId: campaign.id,
          schoolId: school.id,
        },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(evaluationResults.calculateAndPersist).toHaveBeenCalledWith(
      manager,
      submission,
      version,
      expect.objectContaining({
        applicableQuestionIds: new Set([applicableQuestion.id]),
        excludedQuestionIds: new Set([excludedQuestion.id]),
      }),
      actor.id,
      'submission_finalization',
    );
    expect(submission.status).toBe('submitted');
  });

  it('blocks submission when an applicable required question is unanswered', async () => {
    const version = publishedVersion();
    const question = version.dimensions[0].sections[0].questions[0];
    const submission = workspaceSubmission(
      version,
      schoolSnapshot(),
      'draft',
      [],
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: submission.schoolRectificationId,
        isRectified: true,
        snapshot: submission.schoolProfileSnapshot,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(version);
    surveyApplicability.evaluate.mockReturnValue(
      applicabilityFor([question.id]),
    );

    await expect(
      service.submit(campaign.id, { expectedRevision: 0 }, actor),
    ).rejects.toThrow(question.code);
    expect(evaluationResults.calculateAndPersist).not.toHaveBeenCalled();
    expect(submission.status).toBe('draft');
  });

  it.each([
    {
      caseName: 'text below minLength',
      type: SurveyQuestionType.ShortText,
      validation: { minLength: 5 },
      optionId: null,
      value: 'abc',
      expectedMessage: 'demasiado corta',
    },
    {
      caseName: 'text above maxLength',
      type: SurveyQuestionType.LongText,
      validation: { maxLength: 5 },
      optionId: null,
      value: 'abcdef',
      expectedMessage: 'demasiado larga',
    },
    {
      caseName: 'number below min',
      type: SurveyQuestionType.Number,
      validation: { min: 1 },
      optionId: null,
      value: 0,
      expectedMessage: 'no puede ser menor',
    },
    {
      caseName: 'number above max',
      type: SurveyQuestionType.Number,
      validation: { max: 10 },
      optionId: null,
      value: 11,
      expectedMessage: 'no puede ser mayor',
    },
    {
      caseName: 'invalid date',
      type: SurveyQuestionType.Date,
      validation: {},
      optionId: null,
      value: '2026/09/01',
      expectedMessage: 'fecha válida',
    },
    {
      caseName: 'option from another question',
      type: SurveyQuestionType.SingleChoice,
      validation: {},
      optionId: '00000000-0000-4000-8000-000000000999',
      value: null,
      expectedMessage: 'opción válida',
    },
  ])(
    'rejects persisted legacy/direct $caseName before final submission',
    async ({ type, validation, optionId, value, expectedMessage }) => {
      const { question, submission } = arrangeDraftQuestion({
        type,
        required: true,
        validation,
      });
      submission.answers = [
        {
          id: 'legacy-answer-id',
          submissionId: submission.id,
          questionId: question.id,
          optionId,
          value,
        } as SurveyAnswer,
      ];

      await expect(
        service.submit(campaign.id, { expectedRevision: 0 }, actor),
      ).rejects.toThrow(expectedMessage);

      expect(evaluationResults.calculateAndPersist).not.toHaveBeenCalled();
      expect(submission.status).toBe('draft');
    },
  );

  it('does not let a persisted blank row satisfy a required question', async () => {
    const { question, submission } = arrangeDraftQuestion({
      type: SurveyQuestionType.ShortText,
      required: true,
    });
    submission.answers = [
      {
        id: 'legacy-answer-id',
        submissionId: submission.id,
        questionId: question.id,
        optionId: null,
        value: '   ',
      } as SurveyAnswer,
    ];

    await expect(
      service.submit(campaign.id, { expectedRevision: 0 }, actor),
    ).rejects.toThrow(question.code);

    expect(evaluationResults.calculateAndPersist).not.toHaveBeenCalled();
    expect(submission.status).toBe('draft');
  });

  it('rejects a second final submission before recalculating the result', async () => {
    const version = publishedVersion();
    const submission = workspaceSubmission(
      version,
      schoolSnapshot(),
      'submitted',
      [],
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: submission.schoolRectificationId,
        isRectified: true,
        snapshot: submission.schoolProfileSnapshot,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission);

    await expect(
      service.submit(campaign.id, { expectedRevision: 0 }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(surveyApplicability.evaluate).not.toHaveBeenCalled();
    expect(evaluationResults.calculateAndPersist).not.toHaveBeenCalled();
  });

  it('blocks every draft write after the presentation was submitted', async () => {
    const version = publishedVersion();
    const submission = workspaceSubmission(
      version,
      schoolSnapshot(),
      'submitted',
      [],
    );
    schoolsService.evaluationContextForUser.mockResolvedValue({
      school,
      rectification: {
        id: submission.schoolRectificationId,
        isRectified: true,
        snapshot: submission.schoolProfileSnapshot,
      },
    });
    campaignsService.assertOperational.mockResolvedValue(campaign);
    manager.findOne
      .mockResolvedValueOnce(submission)
      .mockResolvedValueOnce(submission);

    await expect(
      service.saveDraft(
        campaign.id,
        { expectedRevision: 0, answers: [] },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(manager.delete).not.toHaveBeenCalledWith(
      SurveyAnswer,
      expect.anything(),
    );
  });

  it.each([
    {
      failure: 'calculation',
      error: new BadRequestException('El resultado calculado es inválido.'),
    },
    {
      failure: 'result persistence',
      error: new ConflictException('No fue posible persistir el resultado.'),
    },
  ])(
    'does not commit the submitted status when $failure fails',
    async ({ error }) => {
      const version = publishedVersion();
      const question = version.dimensions[0].sections[0].questions[0];
      const submission = workspaceSubmission(
        version,
        schoolSnapshot(),
        'draft',
        [],
      );
      submission.answers = [
        {
          id: 'answer-id',
          submissionId: submission.id,
          questionId: question.id,
          optionId: question.options[0].id,
        } as SurveyAnswer,
      ];
      let committedStatus = 'draft';
      dataSource.transaction.mockImplementationOnce(
        async (
          callback: (entityManager: EntityManager) => Promise<unknown>,
        ): Promise<unknown> => {
          const value = await callback(manager as unknown as EntityManager);
          committedStatus = submission.status;
          return value;
        },
      );
      schoolsService.evaluationContextForUser.mockResolvedValue({
        school,
        rectification: {
          id: submission.schoolRectificationId,
          isRectified: true,
          snapshot: submission.schoolProfileSnapshot,
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
      surveyApplicability.evaluate.mockReturnValue(
        applicabilityFor([question.id]),
      );
      evaluationResults.calculateAndPersist.mockRejectedValue(error);

      await expect(
        service.submit(campaign.id, { expectedRevision: 0 }, actor),
      ).rejects.toBe(error);
      expect(committedStatus).toBe('draft');
    },
  );

  it.each(['saveDraft', 'submit'] as const)(
    'keeps %s blocked after the campaign expires',
    async (operation) => {
      schoolsService.evaluationContextForUser.mockResolvedValue({
        school,
        rectification: {
          id: 'rectification-id',
          isConfirmed: true,
          isEvaluationReady: true,
          snapshot: schoolSnapshot(),
        },
      });
      campaignsService.assertOperational.mockRejectedValueOnce(
        new ConflictException(
          'La etapa no se encuentra abierta para recibir respuestas.',
        ),
      );

      const request =
        operation === 'saveDraft'
          ? service.saveDraft(
              campaign.id,
              { expectedRevision: 0, answers: [] },
              actor,
            )
          : service.submit(campaign.id, { expectedRevision: 0 }, actor);

      await expect(request).rejects.toBeInstanceOf(ConflictException);
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(surveyApplicability.evaluate).not.toHaveBeenCalled();
    },
  );
});

function applicabilityFor(
  applicableQuestionIds: string[],
  excludedQuestionIds: string[] = [],
) {
  const evaluatedAt = new Date('2026-01-01T00:00:00.000Z');
  return {
    surveyVersionId: 'version-id',
    status: 'ready',
    source: 'evaluated',
    evaluatedAt,
    decisions: [
      ...applicableQuestionIds.map((questionId) => ({
        questionId,
        questionCode: 'p001',
        surveyVersionId: 'version-id',
        status: 'applicable',
        appliedRuleId: null,
        reasonCode: 'NO_APPLICABILITY_RULES',
        reasonDescription: 'Sin reglas.',
        missingFeatures: [],
        relevantSchoolFacts: {},
        evaluatedAt,
      })),
      ...excludedQuestionIds.map((questionId) => ({
        questionId,
        questionCode: 'p002',
        surveyVersionId: 'version-id',
        status: 'excluded',
        appliedRuleId: 'rule-id',
        reasonCode: 'MATCHED_EXCLUSION_RULE',
        reasonDescription: 'Pregunta excluida.',
        missingFeatures: [],
        relevantSchoolFacts: { has_kiosk: false },
        evaluatedAt,
      })),
    ],
    applicableQuestionIds: new Set(applicableQuestionIds),
    excludedQuestionIds: new Set(excludedQuestionIds),
    incompleteQuestionIds: new Set<string>(),
    missingFields: [],
  };
}

function schoolSnapshot() {
  return {
    name: 'Escuela Uno',
    cue: '500000001',
    directorName: 'Ana',
    address: 'Calle 1',
    locality: 'Mendoza',
    scope: 'Urbano',
    educationLevel: 'Primario',
    shift: 'Simple',
    hasKiosk: false,
  };
}

function workspaceVersion() {
  const version = publishedVersion();
  Object.assign(version, {
    title: 'Cuestionario institucional',
    instructions: null,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    survey: {
      code: 'institucional',
      name: 'Cuestionario institucional',
      description: null,
    },
  });
  return version;
}

function workspaceSubmission(
  version: SurveyVersion,
  snapshot: ReturnType<typeof schoolSnapshot>,
  status: 'draft' | 'submitted',
  applicabilityDecisions: unknown[],
) {
  const campaignWithVersion = {
    id: 'campaign-id',
    name: 'Diagnóstico anual',
    description: null,
    type: CampaignType.Annual,
    status: CampaignStatus.Active,
    surveyVersionId: version.id,
    surveyVersion: version,
    startsAt: new Date('2026-01-01T03:00:00.000Z'),
    endsAt: new Date('2099-01-01T02:59:59.999Z'),
  };
  return {
    id: 'submission-id',
    campaignId: campaignWithVersion.id,
    campaign: campaignWithVersion,
    schoolId: 'school-id',
    surveyVersionId: version.id,
    surveyVersion: version,
    schoolRectificationId: 'rectification-id',
    schoolProfileSnapshot: snapshot,
    originalRespondentSnapshot: {
      id: 'actor-id',
      firstName: 'Ana',
      lastName: 'Directora',
      email: 'escuela@example.com',
    },
    status,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSavedAt: null,
    revision: 0,
    submittedAt:
      status === 'submitted' ? new Date('2026-02-01T00:00:00.000Z') : null,
    answers: [],
    applicabilityDecisions,
  } as SurveySubmission;
}

function publishedVersion() {
  return {
    id: 'version-id',
    versionNumber: 1,
    title: 'Cuestionario institucional',
    instructions: null,
    status: SurveyVersionStatus.Published,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    survey: {
      code: 'institucional',
      name: 'Cuestionario institucional',
      description: null,
    },
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

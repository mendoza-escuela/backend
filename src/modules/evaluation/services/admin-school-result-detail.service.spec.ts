import { DataSource } from 'typeorm';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { User } from '../../users/entities/user.entity';
import { EvaluationResult } from '../entities/evaluation-result.entity';
import { AdminSchoolResultDetailService } from './admin-school-result-detail.service';

describe('AdminSchoolResultDetailService', () => {
  const campaign = {
    id: 'campaign',
    name: 'Campaña',
    type: 'annual',
    status: 'active',
    startsAt: new Date('2026-01-01'),
    endsAt: new Date('2026-12-31'),
    closedAt: null,
  } as Campaign;
  const school = {
    id: 'school',
    cue: '50001',
    name: 'Escuela',
    schoolNumber: null,
    department: 'Capital',
    locality: 'Centro',
    isActive: true,
    createdAt: new Date('2025-01-01'),
  } as School;
  const repositories = new Map<
    unknown,
    { findOneBy?: jest.Mock; findOne?: jest.Mock }
  >();
  let service: AdminSchoolResultDetailService;

  beforeEach(() => {
    repositories.set(Campaign, {
      findOneBy: jest.fn().mockResolvedValue(campaign),
    });
    repositories.set(School, {
      findOneBy: jest.fn().mockResolvedValue(school),
    });
    repositories.set(SurveySubmission, {
      findOne: jest.fn().mockResolvedValue(null),
    });
    repositories.set(CampaignSchool, {
      findOne: jest.fn().mockResolvedValue({
        id: 'assignment',
        campaignId: campaign.id,
        schoolId: school.id,
      }),
    });
    repositories.set(EvaluationResult, {
      findOne: jest.fn().mockResolvedValue(null),
    });
    repositories.set(User, { findOneBy: jest.fn().mockResolvedValue(null) });
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
    } as unknown as DataSource;
    service = new AdminSchoolResultDetailService(dataSource);
  });

  it('devuelve no iniciada sin fabricar presentación ni resultado', async () => {
    await expect(service.get(campaign.id, school.id)).resolves.toEqual(
      expect.objectContaining({
        participationStatus: 'not_started',
        submission: null,
        result: null,
      }),
    );
    expect(repositories.get(EvaluationResult)?.findOne).not.toHaveBeenCalled();
    expect(repositories.get(SurveySubmission)?.findOne).toHaveBeenCalledWith({
      where: { campaignId: campaign.id, schoolId: school.id },
    });
    expect(
      JSON.stringify(await service.get(campaign.id, school.id)),
    ).not.toMatch(/password|token|secret/i);
  });

  it('rechaza campaña o escuela inexistente con errores funcionales', async () => {
    repositories.get(Campaign)?.findOneBy?.mockResolvedValueOnce(null);
    await expect(service.get('missing', school.id)).rejects.toThrow(
      'La campaña no existe.',
    );
    repositories.get(School)?.findOneBy?.mockResolvedValueOnce(null);
    await expect(service.get(campaign.id, 'missing')).rejects.toThrow(
      'La escuela no existe.',
    );
  });

  it('rechaza una escuela posterior al cierre que no tiene historial', async () => {
    repositories.get(CampaignSchool)?.findOne?.mockResolvedValueOnce(null);
    await expect(service.get(campaign.id, school.id)).rejects.toThrow(
      'La escuela no estaba incluida en el universo de esta campaña.',
    );
  });

  it('devuelve el ciclo de vida real de un borrador', async () => {
    repositories.get(SurveySubmission)?.findOne?.mockResolvedValue({
      id: 'submission',
      campaignId: campaign.id,
      schoolId: school.id,
      status: SubmissionStatus.Draft,
      startedAt: new Date('2026-06-01'),
      lastSavedAt: new Date('2026-06-02'),
      submittedAt: null,
      originalRespondentId: null,
      originalRespondentSnapshot: {
        id: 'user',
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
      },
      schoolProfileSnapshot: { name: 'Escuela histórica', cue: '50001' },
    });
    const detail = await service.get(campaign.id, school.id);
    expect(detail).toEqual(
      expect.objectContaining({ participationStatus: 'draft', result: null }),
    );
    expect(detail.history.map((event) => event && event.type)).toEqual([
      'started',
      'saved',
    ]);
    expect(detail.historicalSchoolProfile).toEqual(
      expect.objectContaining({ name: 'Escuela histórica' }),
    );
  });
});

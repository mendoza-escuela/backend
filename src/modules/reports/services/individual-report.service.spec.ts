import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import type { EvaluationSnapshot } from '../../evaluation/evaluation-snapshot.type';
import { EvaluationResult } from '../../evaluation/entities/evaluation-result.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { IndividualReportService } from './individual-report.service';
import { RadarSvgService } from './radar-svg.service';
import { ReportBrandingProvider } from './report-branding.provider';

describe('IndividualReportService', () => {
  const campaignId = '10000000-0000-4000-8000-000000000001';
  const schoolId = '20000000-0000-4000-8000-000000000001';

  it('usa exclusivamente la ficha histórica y no completa campos con la escuela vigente', async () => {
    const { service } = fixture({
      currentSchool: {
        id: schoolId,
        department: 'Departamento actual',
        managementType: 'Gestión actual',
      },
    });

    const view = await service.get(campaignId, schoolId);

    expect(view.school.name).toBe('Escuela histórica');
    expect(view.school.department).toBeUndefined();
    expect(view.school.managementType).toBeUndefined();
  });

  it('no genera el archivo si la escuela no pertenece al universo de la campaña', async () => {
    const { service, repositories } = fixture({ assignment: null });

    await expect(service.get(campaignId, schoolId)).rejects.toThrow(
      new NotFoundException(
        'La escuela no pertenece al universo de esta campaña.',
      ),
    );
    expect(repositories.campaign.findOneBy).not.toHaveBeenCalled();
    expect(repositories.submission.findOne).not.toHaveBeenCalled();
  });

  it('exige una presentación enviada y un resultado con snapshot', async () => {
    const withoutSubmission = fixture({ submission: null });
    await expect(
      withoutSubmission.service.get(campaignId, schoolId),
    ).rejects.toThrow('La presentación todavía no fue enviada.');

    const withoutSnapshot = fixture({ evaluationSnapshot: null });
    await expect(
      withoutSnapshot.service.get(campaignId, schoolId),
    ).rejects.toThrow(
      'La presentación no posee un resultado histórico disponible.',
    );
  });
});

function fixture(overrides?: {
  assignment?: Record<string, unknown> | null;
  currentSchool?: Record<string, unknown> | null;
  submission?: Record<string, unknown> | null;
  evaluationSnapshot?: EvaluationSnapshot | null;
}) {
  const snapshot =
    overrides && 'evaluationSnapshot' in overrides
      ? overrides.evaluationSnapshot
      : historicalSnapshot();
  const repositories = {
    assignment: {
      findOne: jest
        .fn()
        .mockResolvedValue(
          overrides && 'assignment' in overrides
            ? overrides.assignment
            : { campaignId: 'campaign-id', schoolId: 'school-id' },
        ),
    },
    campaign: {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'campaign-id',
        name: 'Campaña histórica',
        startsAt: new Date('2026-01-01T03:00:00.000Z'),
        endsAt: new Date('2026-09-01T02:59:59.999Z'),
      }),
    },
    school: {
      findOneBy: jest
        .fn()
        .mockResolvedValue(
          overrides && 'currentSchool' in overrides
            ? overrides.currentSchool
            : { id: 'school-id' },
        ),
    },
    submission: {
      findOne: jest
        .fn()
        .mockResolvedValue(
          overrides && 'submission' in overrides
            ? overrides.submission
            : { id: 'submission-id' },
        ),
    },
    evaluation: {
      findOneBy: jest.fn().mockResolvedValue({ snapshot }),
    },
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === CampaignSchool) return repositories.assignment;
      if (entity === Campaign) return repositories.campaign;
      if (entity === School) return repositories.school;
      if (entity === SurveySubmission) return repositories.submission;
      if (entity === EvaluationResult) return repositories.evaluation;
      throw new Error('Repositorio inesperado.');
    }),
  };
  const branding = {
    get: jest.fn().mockReturnValue({
      programName: 'Escuelas Promotoras de Salud',
      organizations: 'Gobierno de Mendoza',
      logos: [],
      signer: null,
      signerPosition: null,
      signatureImage: null,
      legalText: null,
      verificationUrl: null,
    }),
  };
  const radar = { create: jest.fn().mockReturnValue('<svg/>') };
  return {
    service: new IndividualReportService(
      dataSource as unknown as DataSource,
      branding as unknown as ReportBrandingProvider,
      radar as unknown as RadarSvgService,
    ),
    repositories,
  };
}

function historicalSnapshot(): EvaluationSnapshot {
  return {
    schemaVersion: 1,
    algorithm: {
      version: 'evaluation-v1',
      calculatedAt: '2026-08-10T12:00:01.000Z',
    },
    result: {
      generalScore: '80',
      numerator: '480',
      denominator: 6,
      stars: {
        value: 4,
        ruleVersion: 'stars-v1',
        blockingReasons: [],
      },
    },
    submission: {
      id: 'submission-id',
      campaignId: 'campaign-id',
      schoolId: 'school-id',
      surveyVersionId: 'version-id',
      schoolRectificationId: 'rectification-id',
      submittedAt: '2026-08-10T12:00:00.000Z',
      originalRespondent: {
        id: 'user-id',
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
      },
    },
    school: {
      name: 'Escuela histórica',
      cue: '5000000',
      directorName: 'Dirección histórica',
      address: 'Dirección histórica 1',
      locality: 'Localidad histórica',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      shift: 'Simple',
    },
    survey: {
      id: 'survey-id',
      code: 'EPS',
      name: 'Cuestionario histórico',
      description: null,
      version: {
        id: 'version-id',
        number: 1,
        title: 'Versión histórica',
        instructions: null,
        publishedAt: '2026-01-01T12:00:00.000Z',
      },
      dimensions: [],
    },
  };
}

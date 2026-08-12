import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import type { EvaluationSnapshot } from '../../evaluation/evaluation-snapshot.type';
import { EvaluationResult } from '../../evaluation/entities/evaluation-result.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { IndividualReportService } from './individual-report.service';
import { RadarSvgService } from './radar-svg.service';
import { ReportBrandingProvider } from './report-branding.provider';

const campaignId = '10000000-0000-4000-8000-000000000001';
const schoolId = '20000000-0000-4000-8000-000000000001';

describe('IndividualReportService', () => {
  it('completa campos antiguos desde el snapshot de la presentación sin mutar los snapshots', async () => {
    const evaluationSnapshot = historicalSnapshot();
    const submissionSnapshot = {
      ...evaluationSnapshot.school,
      department: '  Departamento de la presentación ',
      managementType: ' Gestión de la presentación  ',
    };
    const { service, repositories } = fixture({
      evaluationSnapshot,
      submission: {
        id: 'submission-id',
        schoolProfileSnapshot: submissionSnapshot,
        schoolRectification: {
          id: 'rectification-id',
          schoolId,
          snapshot: {
            ...submissionSnapshot,
            department: 'Departamento de la rectificación',
            managementType: 'Gestión de la rectificación',
          },
        },
      },
    });

    const view = await service.get(campaignId, schoolId);

    expect(view.school.name).toBe('Escuela histórica');
    expect(view.school.department).toBe('Departamento de la presentación');
    expect(view.school.managementType).toBe('Gestión de la presentación');
    expect(evaluationSnapshot.school.department).toBeUndefined();
    expect(evaluationSnapshot.school.managementType).toBeUndefined();
    expect(submissionSnapshot.department).toBe(
      '  Departamento de la presentación ',
    );
    expect(submissionSnapshot.managementType).toBe(
      ' Gestión de la presentación  ',
    );
    expect(repositories.submission.findOne).toHaveBeenCalledWith({
      where: {
        campaignId,
        schoolId,
        status: SubmissionStatus.Submitted,
      },
      relations: { schoolRectification: true },
    });
  });

  it('usa la rectificación histórica vinculada si el snapshot de la presentación no tiene los campos', async () => {
    const evaluationSnapshot = historicalSnapshot();
    delete (
      evaluationSnapshot.submission as Partial<EvaluationSnapshot['submission']>
    ).schoolRectificationId;
    const { service } = fixture({
      evaluationSnapshot,
      submission: {
        id: 'submission-id',
        schoolProfileSnapshot: {
          ...historicalSnapshot().school,
          department: '   ',
        },
        schoolRectification: {
          id: 'rectification-id',
          schoolId,
          snapshot: {
            ...historicalSnapshot().school,
            department: 'Departamento rectificado',
            managementType: 'Gestión rectificada',
          },
        },
      },
    });

    const view = await service.get(campaignId, schoolId);

    expect(view.school.department).toBe('Departamento rectificado');
    expect(view.school.managementType).toBe('Gestión rectificada');
  });

  it('conserva los valores del resultado y no los reemplaza con otras fuentes históricas', async () => {
    const evaluationSnapshot = historicalSnapshot();
    evaluationSnapshot.school.department = 'Departamento del resultado';
    evaluationSnapshot.school.managementType = 'Gestión del resultado';
    const { service } = fixture({
      evaluationSnapshot,
      submission: {
        id: 'submission-id',
        schoolProfileSnapshot: {
          ...historicalSnapshot().school,
          department: 'Departamento de la presentación',
          managementType: 'Gestión de la presentación',
        },
        schoolRectification: {
          id: 'rectification-id',
          schoolId,
          snapshot: {
            ...historicalSnapshot().school,
            department: 'Departamento rectificado',
            managementType: 'Gestión rectificada',
          },
        },
      },
    });

    const view = await service.get(campaignId, schoolId);

    expect(view.school.department).toBe('Departamento del resultado');
    expect(view.school.managementType).toBe('Gestión del resultado');
  });

  it('deja los campos vacíos si no existe ninguna fuente histórica confiable', async () => {
    const { service } = fixture({
      submission: {
        id: 'submission-id',
        schoolProfileSnapshot: historicalSnapshot().school,
        schoolRectification: null,
      },
    });

    const view = await service.get(campaignId, schoolId);

    expect(view.school.department).toBeUndefined();
    expect(view.school.managementType).toBeUndefined();
  });

  it.each([
    {
      caseName: 'la relación referencia otra rectificación',
      relationId: 'otra-rectificacion',
      relationSchoolId: schoolId,
      submissionRectificationId: 'rectification-id',
      evaluationRectificationId: 'rectification-id',
    },
    {
      caseName: 'la rectificación pertenece a otra escuela',
      relationId: 'rectification-id',
      relationSchoolId: 'otra-escuela',
      submissionRectificationId: 'rectification-id',
      evaluationRectificationId: 'rectification-id',
    },
    {
      caseName: 'el resultado referencia otra rectificación',
      relationId: 'rectification-id',
      relationSchoolId: schoolId,
      submissionRectificationId: 'rectification-id',
      evaluationRectificationId: 'otra-rectificacion',
    },
  ])('no usa el fallback cuando $caseName', async (testCase) => {
    const evaluationSnapshot = historicalSnapshot();
    evaluationSnapshot.submission.schoolRectificationId =
      testCase.evaluationRectificationId;
    const { service } = fixture({
      evaluationSnapshot,
      submission: {
        id: 'submission-id',
        schoolId,
        schoolRectificationId: testCase.submissionRectificationId,
        schoolProfileSnapshot: historicalSnapshot().school,
        schoolRectification: {
          id: testCase.relationId,
          schoolId: testCase.relationSchoolId,
          snapshot: {
            ...historicalSnapshot().school,
            department: 'Departamento no confiable',
            managementType: 'Gestión no confiable',
          },
        },
      },
    });

    const view = await service.get(campaignId, schoolId);

    expect(view.school.department).toBeUndefined();
    expect(view.school.managementType).toBeUndefined();
  });

  it('no genera el archivo si la escuela no pertenece al universo de la etapa', async () => {
    const { service, repositories } = fixture({ assignment: null });

    await expect(service.get(campaignId, schoolId)).rejects.toThrow(
      new NotFoundException(
        'La escuela no pertenece al universo de esta etapa.',
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
  submission?: Record<string, unknown> | null;
  evaluationSnapshot?: EvaluationSnapshot | null;
}) {
  const snapshot =
    overrides && 'evaluationSnapshot' in overrides
      ? overrides.evaluationSnapshot
      : historicalSnapshot();
  const defaultSubmission = {
    id: 'submission-id',
    schoolId,
    schoolRectificationId: 'rectification-id',
    schoolProfileSnapshot: historicalSnapshot().school,
    schoolRectification: null,
  };
  const submission =
    overrides && 'submission' in overrides
      ? overrides.submission === null
        ? null
        : { ...defaultSubmission, ...overrides.submission }
      : defaultSubmission;
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
        name: 'Etapa histórica',
        startsAt: new Date('2026-01-01T03:00:00.000Z'),
        endsAt: new Date('2026-09-01T02:59:59.999Z'),
      }),
    },
    submission: {
      findOne: jest.fn().mockResolvedValue(submission),
    },
    evaluation: {
      findOneBy: jest.fn().mockResolvedValue({ snapshot }),
    },
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === CampaignSchool) return repositories.assignment;
      if (entity === Campaign) return repositories.campaign;
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

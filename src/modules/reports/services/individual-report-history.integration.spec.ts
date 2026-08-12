import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import type { EvaluationSnapshot } from '../../evaluation/evaluation-snapshot.type';
import { EvaluationResult } from '../../evaluation/entities/evaluation-result.entity';
import type { SchoolRectificationSnapshot } from '../../schools/entities/school-rectification.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { IndividualReportService } from './individual-report.service';
import { PdfReportRenderer } from './pdf-report.renderer';
import { RadarSvgService } from './radar-svg.service';
import { ReportBrandingProvider } from './report-branding.provider';
import { XlsxReportRenderer } from './xlsx-report.renderer';

describe('Individual report historical school fields', () => {
  it.each([
    {
      label: 'snapshot de evaluación nuevo',
      evaluationSchool: historicalSchool({
        department: 'Departamento del resultado',
        managementType: 'Gestión del resultado',
      }),
      submissionSchool: historicalSchool({
        department: 'Departamento del envío',
        managementType: 'Gestión del envío',
      }),
      rectificationSchool: historicalSchool({
        department: 'Departamento de la rectificación',
        managementType: 'Gestión de la rectificación',
      }),
      expectedDepartment: 'Departamento del resultado',
      expectedManagement: 'Gestión del resultado',
    },
    {
      label: 'snapshot legacy completado desde el envío',
      evaluationSchool: historicalSchool(),
      submissionSchool: historicalSchool({
        department: 'Departamento histórico del envío',
        managementType: 'Gestión histórica del envío',
      }),
      rectificationSchool: historicalSchool({
        department: 'Departamento de la rectificación',
        managementType: 'Gestión de la rectificación',
      }),
      expectedDepartment: 'Departamento histórico del envío',
      expectedManagement: 'Gestión histórica del envío',
    },
    {
      label: 'snapshot legacy completado desde la rectificación vinculada',
      evaluationSchool: historicalSchool(),
      submissionSchool: historicalSchool(),
      rectificationSchool: historicalSchool({
        department: 'Departamento histórico rectificado',
        managementType: 'Gestión histórica rectificada',
      }),
      expectedDepartment: 'Departamento histórico rectificado',
      expectedManagement: 'Gestión histórica rectificada',
    },
  ])(
    'conserva Departamento y Gestión del $label en PDF y XLSX',
    async ({
      evaluationSchool,
      submissionSchool,
      rectificationSchool,
      expectedDepartment,
      expectedManagement,
    }) => {
      const { service, currentSchoolRepository } = fixture({
        evaluationSchool,
        submissionSchool,
        rectificationSchool,
      });

      const view = await service.get(CAMPAIGN_ID, SCHOOL_ID);

      expect(view.school.department).toBe(expectedDepartment);
      expect(view.school.managementType).toBe(expectedManagement);
      expect(currentSchoolRepository.findOneBy).not.toHaveBeenCalled();
      await expectHistoricalFieldsInXlsx(
        view,
        expectedDepartment,
        expectedManagement,
      );
      expectHistoricalFieldsInPdf(view, expectedDepartment, expectedManagement);
    },
  );

  it('no completa un snapshot legacy con la ficha vigente cuando no hay fuente histórica', async () => {
    const { service, currentSchoolRepository } = fixture({
      evaluationSchool: historicalSchool(),
      submissionSchool: historicalSchool(),
      rectificationSchool: null,
    });

    const view = await service.get(CAMPAIGN_ID, SCHOOL_ID);

    expect(view.school.department).toBeUndefined();
    expect(view.school.managementType).toBeUndefined();
    expect(currentSchoolRepository.findOneBy).not.toHaveBeenCalled();
    await expectHistoricalFieldsInXlsx(view, '', '');
    const pdf = serializePdfDefinition(view);
    expect(pdf).not.toContain(CURRENT_DEPARTMENT);
    expect(pdf).not.toContain(CURRENT_MANAGEMENT);
  });

  it('no lleva al PDF ni al XLSX una rectificación que no pertenece a la escuela del envío', async () => {
    const { service } = fixture({
      evaluationSchool: historicalSchool(),
      submissionSchool: historicalSchool(),
      rectificationSchool: historicalSchool({
        department: 'Departamento de una rectificación ajena',
        managementType: 'Gestión de una rectificación ajena',
      }),
      rectificationSchoolId: 'otra-escuela',
    });

    const view = await service.get(CAMPAIGN_ID, SCHOOL_ID);

    expect(view.school.department).toBeUndefined();
    expect(view.school.managementType).toBeUndefined();
    await expectHistoricalFieldsInXlsx(view, '', '');
    const pdf = serializePdfDefinition(view);
    expect(pdf).not.toContain('Departamento de una rectificación ajena');
    expect(pdf).not.toContain('Gestión de una rectificación ajena');
  });
});

const CAMPAIGN_ID = '10000000-0000-4000-8000-000000000001';
const SCHOOL_ID = '20000000-0000-4000-8000-000000000001';
const CURRENT_DEPARTMENT = 'Departamento vigente prohibido';
const CURRENT_MANAGEMENT = 'Gestión vigente prohibida';

function fixture(sources: {
  evaluationSchool: SchoolRectificationSnapshot;
  submissionSchool: SchoolRectificationSnapshot | null;
  rectificationSchool: SchoolRectificationSnapshot | null;
  rectificationSchoolId?: string;
}) {
  const currentSchoolRepository = {
    findOneBy: jest.fn().mockResolvedValue({
      id: SCHOOL_ID,
      department: CURRENT_DEPARTMENT,
      managementType: CURRENT_MANAGEMENT,
    }),
  };
  const repositories = {
    assignment: {
      findOne: jest.fn().mockResolvedValue({
        campaignId: CAMPAIGN_ID,
        schoolId: SCHOOL_ID,
      }),
    },
    campaign: {
      findOneBy: jest.fn().mockResolvedValue({
        id: CAMPAIGN_ID,
        name: 'Etapa histórica',
        startsAt: new Date('2026-01-01T03:00:00.000Z'),
        endsAt: new Date('2026-09-01T02:59:59.999Z'),
      }),
    },
    submission: {
      findOne: jest.fn().mockResolvedValue({
        id: 'submission-id',
        schoolId: SCHOOL_ID,
        schoolRectificationId: 'rectification-id',
        schoolProfileSnapshot: sources.submissionSchool,
        schoolRectification: sources.rectificationSchool
          ? {
              id: 'rectification-id',
              schoolId: sources.rectificationSchoolId ?? SCHOOL_ID,
              snapshot: sources.rectificationSchool,
            }
          : null,
      }),
    },
    evaluation: {
      findOneBy: jest.fn().mockResolvedValue({
        snapshot: evaluationSnapshot(sources.evaluationSchool),
      }),
    },
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === CampaignSchool) return repositories.assignment;
      if (entity === Campaign) return repositories.campaign;
      if (entity === SurveySubmission) return repositories.submission;
      if (entity === EvaluationResult) return repositories.evaluation;
      if (entity === School) return currentSchoolRepository;
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
  const radar = { create: jest.fn().mockReturnValue('<svg></svg>') };
  return {
    service: new IndividualReportService(
      dataSource as unknown as DataSource,
      branding as unknown as ReportBrandingProvider,
      radar as unknown as RadarSvgService,
    ),
    currentSchoolRepository,
  };
}

async function expectHistoricalFieldsInXlsx(
  view: Awaited<ReturnType<IndividualReportService['get']>>,
  department: string,
  management: string,
) {
  const buffer = await new XlsxReportRenderer().report(view);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const summary = workbook.getWorksheet('Resumen');
  const rows = summary?.getRows(2, (summary?.rowCount ?? 1) - 1) ?? [];
  const valueByLabel = new Map(
    rows.map((row) => [row.getCell(2).text, row.getCell(3).text]),
  );
  expect(valueByLabel.get('Departamento')).toBe(department);
  expect(valueByLabel.get('Gestión')).toBe(management);
  expect(Array.from(valueByLabel.values())).not.toContain(CURRENT_DEPARTMENT);
  expect(Array.from(valueByLabel.values())).not.toContain(CURRENT_MANAGEMENT);
}

function expectHistoricalFieldsInPdf(
  view: Awaited<ReturnType<IndividualReportService['get']>>,
  department: string,
  management: string,
) {
  const pdf = serializePdfDefinition(view);
  expect(pdf).toContain(department);
  expect(pdf).toContain(management);
  expect(pdf).not.toContain(CURRENT_DEPARTMENT);
  expect(pdf).not.toContain(CURRENT_MANAGEMENT);
}

function serializePdfDefinition(
  view: Awaited<ReturnType<IndividualReportService['get']>>,
) {
  const renderer = new PdfReportRenderer();
  const printer = (
    renderer as unknown as {
      printer: { createPdfKitDocument: (definition: unknown) => unknown };
    }
  ).printer;
  const create = jest
    .spyOn(printer, 'createPdfKitDocument')
    .mockReturnValue({});
  renderer.report(view);
  return JSON.stringify(create.mock.calls[0][0]);
}

function historicalSchool(
  overrides: Partial<SchoolRectificationSnapshot> = {},
): SchoolRectificationSnapshot {
  return {
    name: 'Escuela histórica',
    cue: '5000000',
    directorName: 'Dirección histórica',
    address: 'Dirección histórica 1',
    locality: 'Localidad histórica',
    scope: 'Urbano',
    educationLevel: 'Educación común',
    shift: 'Simple',
    ...overrides,
  };
}

function evaluationSnapshot(
  school: SchoolRectificationSnapshot,
): EvaluationSnapshot {
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
      campaignId: CAMPAIGN_ID,
      schoolId: SCHOOL_ID,
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
    school,
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

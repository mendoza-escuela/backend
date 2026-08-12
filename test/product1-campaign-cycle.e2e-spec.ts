import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { writeFile } from 'node:fs/promises';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { spanishValidationException } from '../src/common/validation/spanish-validation-errors';
import { parseFrontendOrigin } from '../src/config/frontend-origins';
import { OFFICIAL_KIOSK_QUESTION_CODES } from '../src/modules/surveys/policies/official-survey-applicability.policy';
import { OFFICIAL_SURVEY_DIMENSIONS } from '../src/modules/surveys/templates/official-survey-dimensions.template';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

type CampaignBody = { id: string; status?: string };
type AssignmentBody = {
  matched: number;
  assigned: number;
  summary: { assigned: number };
};
type AvailableCampaignsBody = {
  items: Array<{ id: string; canStart: boolean }>;
};
type SubmissionWorkspaceBody = {
  submission: {
    id: string;
    status: string;
    progress: { answered: number; total: number; percentage: number };
  };
  applicability: {
    excluded: Array<{ questionCode: string }>;
  };
};
type ResultsDashboardBody = {
  metrics: {
    dimensionAverages: Array<{ average: number; denominator: number }>;
  };
};
type ComparisonDashboardBody = {
  baselineCampaignId: string;
  comparisonPolicy: {
    standardizedMetrics: string[];
    dimensionSeries: string;
    cohortMode: string;
    schoolProfileSource: string;
    filterScope: string;
    excludedOutcomeFilters: string[];
    notice: string;
  };
  radarComparison: {
    available: boolean;
    comparable: boolean;
    mode: string;
    reason: string | null;
  };
  commonDimensions: Array<{ code: string }>;
  periods: Array<{
    campaign: { id: string };
    metrics: {
      generalAverage: number;
      schoolsWithResult: number;
      dimensionAverages: Array<{ code: string; average: number }>;
    };
    starDistribution: Array<{ stars: number; count: number }>;
  }>;
};
type CriticalAlertsBody = {
  summary: {
    schoolsCount: number;
    schoolsWithResult: number;
    schoolsPercentage: number;
    alertsCount: number;
    affectedDimensionCount: number;
  };
};
type DataQualityAuditBody = {
  fingerprint: string;
  affectedSubmissionCount: number;
  affectedQuestionDecisionCount: number;
  repairable: boolean;
  submissions: Array<{
    submissionId: string;
    questionCodes: string[];
    previousResult: {
      generalScore: string | null;
      generalNumerator: string | null;
      generalDenominator: number | null;
      calculatedAt: string | null;
      algorithmVersion: string | null;
      evaluationConfigurationId: string | null;
      evaluationConfigurationVersion: string | null;
    };
    recalculationBlockers: string[];
  }>;
};
type CampaignTrackingBody = {
  items: Array<{
    progress: { answered: number; applicable: number; percentage: number };
  }>;
};
type ImportSummaryBody = {
  totalRows: number;
  validCount?: number;
  importedCount?: number;
  errorCount: number;
};
type SchoolPortalBody = {
  id: string;
  cue: string;
  name: string;
  directorName: string;
  department: string;
  address: string;
  locality: string;
  managementType: string;
  scope: string;
  educationLevel: string;
  shift: string;
  shiftCatalog: { id: string; code: string; label: string } | null;
  educationLevels: Array<{
    levelId: string;
    code: string;
    label: string;
    enrollment: number | null;
  }>;
  hasKiosk: boolean | null;
  hasFoodService: boolean | null;
  isBoarding: boolean | null;
  updatedAt: string;
  rectifications: Array<{
    id: string;
    periodYear: number;
    snapshot: { schemaVersion?: number };
  }>;
};
type StructuredConflictBody = {
  code: string;
  field: string;
  message: string;
};

describeWithDatabase('Producto 1 campaign-to-result cycle (PostgreSQL)', () => {
  let app: INestApplication<Server>;
  let dataSource: DataSource;
  let surveyVersionId: string;
  let primarySchoolId: string;
  let secondarySchoolId: string;
  const baseAnswers: Array<{ questionId: string; optionId: string }> = [];
  const password = 'E2e-Producto1-2026!';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: spanishValidationException,
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
    await seedProductOneCycle();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('creates, assigns, activates, submits and calculates without a 500', async () => {
    const httpServer = app.getHttpServer();
    const admin = request.agent(httpServer).set(csrfHeaders());
    const school = request.agent(httpServer).set(csrfHeaders());
    await admin
      .post('/api/auth/login')
      .send({ email: 'admin.e2e@example.com', password })
      .expect(200);
    await school
      .post('/api/auth/login')
      .send({ email: 'school.e2e@example.com', password })
      .expect(200);

    await school.get('/api/admin/campaigns').expect(403);
    await admin.get('/api/school/campaigns').expect(403);

    const dates = campaignDates();
    const emptyCampaign = await admin
      .post('/api/admin/campaigns')
      .send({
        name: 'Etapa sin escuelas E2E',
        type: 'annual',
        surveyVersionId,
        ...dates,
      })
      .expect(201);
    const emptyCampaignBody = emptyCampaign.body as CampaignBody;
    await admin
      .patch(`/api/admin/campaigns/${emptyCampaignBody.id}/status`)
      .send({ status: 'active' })
      .expect(409);

    const campaignResponse = await admin
      .post('/api/admin/campaigns')
      .send({
        name: 'Etapa Producto 1 E2E',
        description: 'Ciclo real sobre PostgreSQL',
        type: 'annual',
        surveyVersionId,
        ...dates,
      })
      .expect(201);
    const campaignId = (campaignResponse.body as CampaignBody).id;

    await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({ source: 'manual', schoolIds: [] })
      .expect(400);
    await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({
        source: 'manual',
        schoolIds: ['10000000-0000-4000-8000-000000000099'],
      })
      .expect(400);

    const firstAssignment = await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({ source: 'manual', schoolIds: [primarySchoolId] })
      .expect(201);
    expect(firstAssignment.body).toMatchObject({ matched: 1, assigned: 1 });

    const repeatedAssignment = await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({ source: 'manual', schoolIds: [primarySchoolId] })
      .expect(201);
    expect(repeatedAssignment.body).toMatchObject({ matched: 1, assigned: 0 });

    await admin
      .delete(`/api/admin/campaigns/${campaignId}/schools/${primarySchoolId}`)
      .send({ reason: 'Prueba de reactivación' })
      .expect(200);
    const reactivated = await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({ source: 'manual', schoolIds: [primarySchoolId] })
      .expect(201);
    expect(reactivated.body).toMatchObject({ matched: 1, assigned: 1 });

    const activated = await admin
      .patch(`/api/admin/campaigns/${campaignId}/status`)
      .send({ status: 'active' })
      .expect(200);
    expect((activated.body as CampaignBody).status).toBe('active');

    const activePreview = await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/preview`)
      .send({ source: 'manual', schoolIds: [secondarySchoolId] })
      .expect(201);
    expect(activePreview.body).toMatchObject({
      matched: 1,
      alreadyAssigned: 0,
      willAssign: 1,
    });
    const activeAssignment = await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({ source: 'manual', schoolIds: [secondarySchoolId] })
      .expect(201);
    expect(activeAssignment.body as AssignmentBody).toMatchObject({
      matched: 1,
      assigned: 1,
      summary: { assigned: 2 },
    });
    const [activeAssignmentTrace] = await dataSource.query<
      Array<{
        assignedAt: Date;
        assignedByEmail: string;
        assignmentSource: string;
        auditAssignedAt: string;
        auditCampaignStatus: string;
        auditAssignedSchoolIds: string[];
      }>
    >(
      `SELECT
         assignment.assigned_at AS "assignedAt",
         actor.email AS "assignedByEmail",
         assignment.assignment_source AS "assignmentSource",
         audit.changes->>'assignedAt' AS "auditAssignedAt",
         audit.changes->>'campaignStatus' AS "auditCampaignStatus",
         audit.changes->'assignedSchoolIds' AS "auditAssignedSchoolIds"
       FROM campaign_schools assignment
       INNER JOIN users actor ON actor.id = assignment.assigned_by_user_id
       INNER JOIN LATERAL (
         SELECT log.changes
         FROM audit_logs log
         WHERE log.action = 'CAMPAIGN_SCHOOLS_ASSIGNED'
           AND log.entity_id = assignment.campaign_id
           AND log.changes->>'campaignStatus' = 'active'
         ORDER BY log.created_at DESC
         LIMIT 1
       ) audit ON true
       WHERE assignment.campaign_id = $1 AND assignment.school_id = $2`,
      [campaignId, secondarySchoolId],
    );
    expect(activeAssignmentTrace).toMatchObject({
      assignedByEmail: 'admin.e2e@example.com',
      assignmentSource: 'manual',
      auditCampaignStatus: 'active',
      auditAssignedSchoolIds: [secondarySchoolId],
    });
    expect(activeAssignmentTrace.assignedAt).toBeInstanceOf(Date);
    expect(new Date(activeAssignmentTrace.auditAssignedAt).getTime()).toBe(
      activeAssignmentTrace.assignedAt.getTime(),
    );

    const filtered = await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({ source: 'filter', department: 'Godoy Cruz', isActive: true })
      .expect(201);
    const filteredBody = filtered.body as AssignmentBody;
    expect(filteredBody).toMatchObject({ matched: 1, assigned: 0 });
    expect(filteredBody.summary.assigned).toBe(2);
    const bulkAssignment = await admin
      .post(`/api/admin/campaigns/${campaignId}/schools/assign`)
      .send({ source: 'bulk', isActive: true })
      .expect(201);
    expect(bulkAssignment.body as AssignmentBody).toMatchObject({
      matched: 2,
      assigned: 0,
      summary: { assigned: 2 },
    });
    await admin
      .delete(`/api/admin/campaigns/${campaignId}/schools/${secondarySchoolId}`)
      .send({ reason: 'No se permiten bajas durante la etapa activa' })
      .expect(409);

    const available = await school.get('/api/school/campaigns').expect(200);
    const availableBody = available.body as AvailableCampaignsBody;
    expect(availableBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: campaignId, canStart: true }),
      ]),
    );
    const started = await school
      .post(`/api/school/campaigns/${campaignId}/submission`)
      .expect(201);
    const startedBody = started.body as SubmissionWorkspaceBody;
    const submissionId = startedBody.submission.id;
    expect(startedBody.submission).toMatchObject({
      status: 'draft',
      progress: { total: 53 },
    });
    expect(startedBody.applicability.excluded).toHaveLength(7);
    expect(
      startedBody.applicability.excluded.map(
        (decision) => decision.questionCode,
      ),
    ).toEqual(['p021', 'p022', 'p023', 'p024', 'p025', 'p026', 'p027']);

    const draft = await school
      .put(`/api/school/campaigns/${campaignId}/submission/draft`)
      .send({ answers: baseAnswers })
      .expect(200);
    expect(
      (draft.body as SubmissionWorkspaceBody).submission.progress,
    ).toMatchObject({ answered: 53, total: 53, percentage: 100 });

    // Conserva el escenario histórico real: el envío puede tener respuestas
    // residuales para las siete preguntas que luego quedaron excluidas.
    await dataSource.query(
      `INSERT INTO survey_answers (submission_id, question_id, option_id)
       SELECT $1, question.id, option.id
       FROM survey_questions question
       INNER JOIN survey_sections section ON section.id = question.section_id
       INNER JOIN survey_dimensions dimension ON dimension.id = section.dimension_id
       INNER JOIN survey_options option ON option.question_id = question.id
       WHERE dimension.version_id = $2
         AND LOWER(question.code) = ANY($3::text[])`,
      [submissionId, surveyVersionId, OFFICIAL_KIOSK_QUESTION_CODES],
    );
    const submitted = await school
      .post(`/api/school/campaigns/${campaignId}/submission/submit`)
      .expect(201);
    expect((submitted.body as SubmissionWorkspaceBody).submission.status).toBe(
      'submitted',
    );

    const [historicalResult] = await dataSource.query<
      Array<{
        submissionId: string;
        generalScore: string;
        numerator: string;
        denominator: number;
        algorithmVersion: string;
        evaluationConfigurationId: string;
        evaluationConfigurationVersion: string;
        calculatedAt: Date;
      }>
    >(
      `SELECT
           result.submission_id AS "submissionId",
           result.general_score AS "generalScore",
           result.general_numerator AS numerator,
           result.general_denominator AS denominator,
           result.algorithm_version AS "algorithmVersion",
           result.evaluation_configuration_id AS "evaluationConfigurationId",
           result.evaluation_configuration_version AS "evaluationConfigurationVersion",
           result.calculated_at AS "calculatedAt"
         FROM evaluation_results result
         WHERE result.campaign_id = $1 AND result.school_id = $2`,
      [campaignId, primarySchoolId],
    );
    expect(historicalResult.submissionId).toBe(submissionId);
    expect(historicalResult).toMatchObject({
      generalScore: '100.00000000',
      numerator: '5300.00000000',
      denominator: 53,
    });
    const decisions = await dataSource.query<Array<{ status: string }>>(
      `SELECT applicability.status
       FROM submission_question_applicability applicability
       INNER JOIN survey_questions question ON question.id = applicability.question_id
       WHERE applicability.submission_id = $1
         AND LOWER(question.code) = ANY($2::text[])
       ORDER BY question.code`,
      [submissionId, OFFICIAL_KIOSK_QUESTION_CODES],
    );
    expect(decisions).toHaveLength(7);
    expect(decisions.every(({ status }) => status === 'excluded')).toBe(true);

    const result = await school
      .get(`/api/school/campaigns/${campaignId}/submission/result`)
      .expect(200);
    expect(result.body).toMatchObject({
      result: { generalScore: 100, numerator: 5300, denominator: 53 },
    });

    const participationFilters = await admin
      .get('/api/admin/dashboard/participation/filters')
      .query({ campaignId })
      .expect(200);
    expect(participationFilters.body).toMatchObject({
      defaultCampaignId: campaignId,
      educationLevelOptions: [{ value: 'primario', label: 'Primario' }],
    });

    const repeatedMultiFilterQuery =
      `campaignId=${encodeURIComponent(campaignId)}` +
      '&departments=Capital' +
      '&departments=Godoy%20Cruz' +
      '&educationLevels=primario' +
      '&submissionStatuses=not_started' +
      '&submissionStatuses=submitted';
    const participationWithMultipleFilters = await admin
      .get(`/api/admin/dashboard/participation?${repeatedMultiFilterQuery}`)
      .expect(200);
    expect(participationWithMultipleFilters.body).toMatchObject({
      metrics: {
        totalSchools: 2,
        notStarted: 1,
        draft: 0,
        submitted: 1,
        participationPercentage: 50,
      },
    });
    const exportWithMultipleFilters = await admin
      .get(`/api/admin/exports/results?${repeatedMultiFilterQuery}&format=csv`)
      .expect(200);
    expect(exportWithMultipleFilters.text).toContain('"E2E-0001"');
    expect(exportWithMultipleFilters.text).toContain('"E2E-0002"');
    expect(exportWithMultipleFilters.text).toContain(
      '"Tipo de educación","Niveles educativos"',
    );
    expect(exportWithMultipleFilters.text).toContain(
      '"Educación común","Primario [primario]"',
    );

    const dashboard = await admin
      .get('/api/admin/dashboard/results')
      .query({ campaignId })
      .expect(200);
    const dashboardBody = dashboard.body as ResultsDashboardBody;
    expect(dashboardBody.metrics.dimensionAverages).toHaveLength(6);
    expect(
      dashboardBody.metrics.dimensionAverages.every(
        (dimension) => dimension.average === 100 && dimension.denominator === 1,
      ),
    ).toBe(true);

    const comparisonCampaignResponse = await admin
      .post('/api/admin/campaigns')
      .send({
        name: 'Etapa comparativa E2E',
        description: 'Segundo período para DASH-08',
        type: 'annual',
        surveyVersionId,
        ...dates,
      })
      .expect(201);
    const comparisonCampaignId = (
      comparisonCampaignResponse.body as CampaignBody
    ).id;
    await admin
      .post(`/api/admin/campaigns/${comparisonCampaignId}/schools/assign`)
      .send({ source: 'manual', schoolIds: [primarySchoolId] })
      .expect(201);
    await admin
      .patch(`/api/admin/campaigns/${comparisonCampaignId}/status`)
      .send({ status: 'active' })
      .expect(200);
    await school
      .post(`/api/school/campaigns/${comparisonCampaignId}/submission`)
      .expect(201);
    await school
      .put(`/api/school/campaigns/${comparisonCampaignId}/submission/draft`)
      .send({ answers: baseAnswers })
      .expect(200);
    await school
      .post(`/api/school/campaigns/${comparisonCampaignId}/submission/submit`)
      .expect(201);

    const comparison = await admin
      .get('/api/admin/dashboard/results/comparison')
      .query({
        campaignIds: [campaignId, comparisonCampaignId],
        schoolIds: [primarySchoolId],
      })
      .expect(200);
    const comparisonBody = comparison.body as ComparisonDashboardBody;
    expect(comparisonBody.baselineCampaignId).toBe(campaignId);
    expect(comparisonBody.periods.map(({ campaign }) => campaign.id)).toEqual([
      campaignId,
      comparisonCampaignId,
    ]);
    expect(comparisonBody.periods[0].metrics).toMatchObject({
      generalAverage: 100,
      schoolsWithResult: 1,
    });
    expect(comparisonBody.periods[1].metrics).toMatchObject({
      generalAverage: 100,
      schoolsWithResult: 1,
    });
    expect(
      comparisonBody.periods.every(
        (period) => period.metrics.dimensionAverages.length === 6,
      ),
    ).toBe(true);
    expect(comparisonBody.commonDimensions).toHaveLength(6);
    expect(comparisonBody.radarComparison).toMatchObject({
      available: true,
      comparable: true,
      mode: 'comparable',
      reason: null,
    });
    expect(comparisonBody.comparisonPolicy).toEqual({
      standardizedMetrics: ['generalScore', 'stars'],
      dimensionSeries: 'visual_trajectory',
      cohortMode: 'independent_campaign_universes',
      schoolProfileSource: 'current',
      filterScope: 'institutional_only',
      excludedOutcomeFilters: ['submissionStatuses', 'stars', 'criticalAreas'],
      notice: comparisonBody.comparisonPolicy.notice,
    });
    expect(comparisonBody.comparisonPolicy.notice.length).toBeGreaterThan(20);

    const aggregateComparison = await admin
      .get('/api/admin/dashboard/results/comparison')
      .query({ campaignIds: [campaignId, comparisonCampaignId] })
      .expect(200);
    expect(
      (aggregateComparison.body as ComparisonDashboardBody).radarComparison,
    ).toMatchObject({
      available: false,
      comparable: false,
      mode: 'unavailable',
      reason: 'single_school_required',
    });
    expect(
      (aggregateComparison.body as ComparisonDashboardBody).periods.every(
        (period) => period.metrics.dimensionAverages.length === 0,
      ),
    ).toBe(true);

    const duplicatedCampaignQuery =
      `campaignIds=${encodeURIComponent(campaignId)}` +
      `&campaignIds=${encodeURIComponent(comparisonCampaignId)}` +
      `&campaignIds=${encodeURIComponent(campaignId)}`;
    await admin
      .get(`/api/admin/dashboard/results/comparison?${duplicatedCampaignQuery}`)
      .expect(400);
    await admin
      .get('/api/admin/dashboard/results/comparison')
      .query({
        campaignIds: [campaignId, comparisonCampaignId],
        stars: [5],
      })
      .expect(400);
    await admin
      .get('/api/admin/dashboard/results/comparison')
      .query({
        campaignIds: [campaignId, emptyCampaignBody.id],
        schoolIds: [primarySchoolId],
      })
      .expect(409);

    const critical = await admin
      .get('/api/admin/dashboard/results/critical-alerts')
      .query({ campaignId, page: 1, limit: 10 })
      .expect(200);
    expect((critical.body as CriticalAlertsBody).summary).toMatchObject({
      schoolsCount: 0,
      schoolsWithResult: 1,
      schoolsPercentage: 0,
      alertsCount: 0,
      affectedDimensionCount: 0,
    });
    await school
      .get('/api/admin/dashboard/results/critical-alerts')
      .query({ campaignId, page: 1, limit: 10 })
      .expect(403);
    await dataSource.query(
      `UPDATE evaluation_dimension_results dimension_result
       SET numerator = 20, score = 20, is_critical = true,
           critical_value = 20, critical_threshold = 33,
           critical_rule_version = 'e2e-critical-rule'
       FROM evaluation_results evaluation
       WHERE dimension_result.result_id = evaluation.id
         AND evaluation.submission_id = $1
         AND dimension_result."order" IN (1, 6)`,
      [submissionId],
    );
    const consolidatedCritical = await admin
      .get('/api/admin/dashboard/results/critical-alerts')
      .query({ campaignId, page: 1, limit: 10 })
      .expect(200);
    const consolidatedCriticalBody =
      consolidatedCritical.body as CriticalAlertsBody & {
        items: Array<{ dimensions: Array<{ code: string }> }>;
      };
    expect(consolidatedCriticalBody.summary).toMatchObject({
      schoolsCount: 1,
      schoolsWithResult: 1,
      schoolsPercentage: 100,
      alertsCount: 2,
      affectedDimensionCount: 2,
    });
    expect(consolidatedCriticalBody.items).toHaveLength(1);
    expect(consolidatedCriticalBody.items[0].dimensions).toHaveLength(2);
    const filteredCritical = await admin
      .get('/api/admin/dashboard/results/critical-alerts')
      .query({
        campaignId,
        dimensionCode: 'compromiso_institucional',
        page: 1,
        limit: 10,
      })
      .expect(200);
    const filteredCriticalDimensions = (
      filteredCritical.body as {
        items: Array<{
          dimensions: Array<{
            code: string;
            title: string;
            score: number;
            threshold: number;
            order: number;
          }>;
        }>;
      }
    ).items[0].dimensions;
    expect(filteredCriticalDimensions).toEqual([
      {
        code: 'compromiso_institucional',
        title: 'Compromiso Institucional y Planificación Estratégica',
        score: 20,
        threshold: 33,
        order: 1,
      },
    ]);

    const xlsx = await admin
      .get('/api/admin/exports/results')
      .query({ campaignId, format: 'xlsx' })
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect(
        'content-type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    const workbook = await JSZip.loadAsync(xlsx.body as Buffer, {
      checkCRC32: true,
    });
    expect(workbook.file('xl/workbook.xml')).not.toBeNull();
    const answersXlsx = await admin
      .get('/api/admin/exports/answers')
      .query({ campaignId, format: 'xlsx' })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    await expect(
      JSZip.loadAsync(answersXlsx.body as Buffer, { checkCRC32: true }),
    ).resolves.toBeDefined();
    const csv = await admin
      .get('/api/admin/exports/answers')
      .query({ campaignId, format: 'csv' })
      .expect(200);
    expect(csv.text).toContain('"p021"');
    expect(csv.text).toContain('"No","Sí"');

    const report = await school
      .get(`/api/school/campaigns/${campaignId}/submission/report.pdf`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect('content-type', 'application/pdf')
      .expect('cache-control', 'private, no-store');
    expect((report.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((report.body as Buffer).length).toBeGreaterThan(5_000);
    if (process.env.PRODUCT1_REPORT_ARTIFACT_PATH)
      await writeFile(
        process.env.PRODUCT1_REPORT_ARTIFACT_PATH,
        report.body as Buffer,
      );
    const receipt = await school
      .get(`/api/school/campaigns/${campaignId}/submission/receipt.pdf`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect('cache-control', 'private, no-store');
    expect((receipt.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const schoolXlsx = await school
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect(
        'content-type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .expect(
        'content-disposition',
        'attachment; filename="reporte-E2E-0001.xlsx"',
      )
      .expect('cache-control', 'private, no-store');
    const schoolWorkbook = await JSZip.loadAsync(schoolXlsx.body as Buffer, {
      checkCRC32: true,
    });
    const schoolWorkbookXml = await schoolWorkbook
      .file('xl/workbook.xml')
      ?.async('text');
    expect(schoolWorkbookXml).toContain('name="Resumen"');
    expect(schoolWorkbookXml).toContain('name="Dimensiones"');
    expect(schoolWorkbookXml).toContain('name="Respuestas"');
    expect(schoolWorkbookXml).toContain('name="Exclusiones"');

    await admin
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .expect(403);
    await school
      .get(
        `/api/school/campaigns/${emptyCampaignBody.id}/submission/report.xlsx`,
      )
      .expect(404);
    const otherSchool = request.agent(httpServer).set(csrfHeaders());
    await otherSchool
      .post('/api/auth/login')
      .send({ email: 'new-school.e2e@example.com', password })
      .expect(200);
    await otherSchool
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .expect(404);
    const [{ xlsxDownloadAudits }] = await dataSource.query<
      Array<{ xlsxDownloadAudits: number }>
    >(
      `SELECT COUNT(*)::integer AS "xlsxDownloadAudits"
       FROM audit_logs
       WHERE action = 'INDIVIDUAL_XLSX_REPORT_DOWNLOADED'
         AND entity_id = $1
         AND actor_user_id = (
           SELECT id FROM users WHERE email = 'school.e2e@example.com'
         )`,
      [submissionId],
    );
    expect(xlsxDownloadAudits).toBe(1);

    const dataAudit = await admin
      .get('/api/admin/evaluation/data-quality/kiosk-applicability')
      .query({ campaignId })
      .expect(200);
    expect(dataAudit.body).toMatchObject({
      affectedSubmissionCount: 0,
      affectedQuestionDecisionCount: 0,
      submissions: [],
    });

    const replacementConfiguration = await admin
      .post('/api/admin/evaluation-configurations')
      .send(
        evaluationConfigurationInput(
          'v-e2e-active-after-submission',
          'Configuración activa posterior al envío E2E',
        ),
      )
      .expect(201);
    const replacementConfigurationId = (
      replacementConfiguration.body as { id: string }
    ).id;
    await admin
      .post(
        `/api/admin/evaluation-configurations/${replacementConfigurationId}/activate`,
      )
      .expect(201);
    expect(replacementConfigurationId).not.toBe(
      historicalResult.evaluationConfigurationId,
    );

    const introduceSyntheticHistoricalDefect = `
      UPDATE submission_question_applicability applicability
      SET status = 'applicable', reason_code = 'DEFAULT_SHOW',
          reason_description = 'Decisión defectuosa sintética para E2E',
          evaluated_at = now()
      FROM survey_questions question
      WHERE applicability.question_id = question.id
        AND applicability.submission_id = $1
        AND LOWER(question.code) = ANY($2::text[])`;
    await expect(
      dataSource.query(introduceSyntheticHistoricalDefect, [
        submissionId,
        OFFICIAL_KIOSK_QUESTION_CODES,
      ]),
    ).rejects.toThrow(
      'La aplicabilidad de una presentación enviada es inmutable',
    );
    await dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT set_config('ops.allow_kiosk_applicability_repair', 'on', true)`,
      );
      await manager.query(introduceSyntheticHistoricalDefect, [
        submissionId,
        OFFICIAL_KIOSK_QUESTION_CODES,
      ]);
      await manager.query(
        `UPDATE evaluation_results
         SET general_numerator = 6000, general_denominator = 60,
             general_score = 100
         WHERE submission_id = $1`,
        [submissionId],
      );
    });

    const trackingBeforeRepair = await admin
      .get(`/api/admin/campaigns/${campaignId}/tracking`)
      .query({ page: 1, limit: 20, search: 'E2E-0001' })
      .expect(200);
    expect((trackingBeforeRepair.body as CampaignTrackingBody).items).toEqual([
      expect.objectContaining({
        progress: { answered: 60, applicable: 60, percentage: 100 },
      }),
    ]);

    const affectedAudit = await admin
      .get('/api/admin/evaluation/data-quality/kiosk-applicability')
      .query({ campaignId })
      .expect(200);
    const affectedAuditBody = affectedAudit.body as DataQualityAuditBody;
    expect(affectedAuditBody).toMatchObject({
      affectedSubmissionCount: 1,
      affectedQuestionDecisionCount: 7,
      repairable: true,
    });
    expect(affectedAuditBody.submissions).toHaveLength(1);
    expect(affectedAuditBody.submissions[0]).toMatchObject({
      submissionId,
      questionCodes: ['p021', 'p022', 'p023', 'p024', 'p025', 'p026', 'p027'],
      recalculationBlockers: [],
    });
    expect(affectedAuditBody.submissions[0].previousResult).toMatchObject({
      generalNumerator: '6000.00000000',
      generalDenominator: 60,
      algorithmVersion: historicalResult.algorithmVersion,
      evaluationConfigurationId: historicalResult.evaluationConfigurationId,
      evaluationConfigurationVersion:
        historicalResult.evaluationConfigurationVersion,
    });
    const exactPreview = await admin
      .post('/api/admin/evaluation/data-quality/kiosk-applicability/preview')
      .send({ submissionIds: [submissionId] })
      .expect(201);
    const exactPreviewBody = exactPreview.body as DataQualityAuditBody;
    expect(exactPreviewBody).toMatchObject({
      affectedSubmissionCount: 1,
      affectedQuestionDecisionCount: 7,
      repairable: true,
      submissions: [
        expect.objectContaining({
          submissionId,
          questionCodes: [
            'p021',
            'p022',
            'p023',
            'p024',
            'p025',
            'p026',
            'p027',
          ],
          recalculationBlockers: [],
        }),
      ],
    });
    const repairPayload = {
      targets: [{ submissionId }],
      previewFingerprint: exactPreviewBody.fingerprint,
    };
    await admin
      .post('/api/admin/evaluation/data-quality/kiosk-applicability/repair')
      .send({ ...repairPayload, confirm: false })
      .expect(400);
    const repaired = await admin
      .post('/api/admin/evaluation/data-quality/kiosk-applicability/repair')
      .send({ ...repairPayload, confirm: true })
      .expect(201);
    expect(repaired.body).toMatchObject({
      correctedSubmissionCount: 1,
      correctedQuestionDecisionCount: 7,
    });
    const correctedDecisions = await dataSource.query<
      Array<{ questionCode: string; status: string; reasonCode: string }>
    >(
      `SELECT LOWER(question.code) AS "questionCode", applicability.status,
              applicability.reason_code AS "reasonCode"
       FROM submission_question_applicability applicability
       INNER JOIN survey_questions question ON question.id = applicability.question_id
       WHERE applicability.submission_id = $1
         AND LOWER(question.code) = ANY($2::text[])
       ORDER BY LOWER(question.code)`,
      [submissionId, OFFICIAL_KIOSK_QUESTION_CODES],
    );
    expect(correctedDecisions).toEqual(
      OFFICIAL_KIOSK_QUESTION_CODES.map((questionCode) => ({
        questionCode,
        status: 'excluded',
        reasonCode: 'DATA_CORRECTION_KIOSK_NOT_APPLICABLE',
      })),
    );
    const [recalculatedResult] = await dataSource.query<
      Array<{
        generalNumerator: string;
        generalDenominator: number;
        algorithmVersion: string;
        evaluationConfigurationId: string;
        evaluationConfigurationVersion: string;
        calculatedAt: Date;
      }>
    >(
      `SELECT general_numerator AS "generalNumerator",
              general_denominator AS "generalDenominator",
              algorithm_version AS "algorithmVersion",
              evaluation_configuration_id AS "evaluationConfigurationId",
              evaluation_configuration_version AS "evaluationConfigurationVersion",
              calculated_at AS "calculatedAt"
       FROM evaluation_results
       WHERE submission_id = $1`,
      [submissionId],
    );
    expect(recalculatedResult).toMatchObject({
      generalNumerator: '5300.00000000',
      generalDenominator: 53,
      algorithmVersion: historicalResult.algorithmVersion,
      evaluationConfigurationId: historicalResult.evaluationConfigurationId,
      evaluationConfigurationVersion:
        historicalResult.evaluationConfigurationVersion,
    });
    expect(recalculatedResult.evaluationConfigurationId).not.toBe(
      replacementConfigurationId,
    );
    expect(recalculatedResult.calculatedAt.getTime()).toBeGreaterThan(
      historicalResult.calculatedAt.getTime(),
    );

    const trackingAfterRepair = await admin
      .get(`/api/admin/campaigns/${campaignId}/tracking`)
      .query({ page: 1, limit: 20, search: 'E2E-0001' })
      .expect(200);
    expect((trackingAfterRepair.body as CampaignTrackingBody).items).toEqual([
      expect.objectContaining({
        progress: { answered: 53, applicable: 53, percentage: 100 },
      }),
    ]);
    const [{ residualKioskAnswers }] = await dataSource.query<
      Array<{ residualKioskAnswers: number }>
    >(
      `SELECT COUNT(*)::integer AS "residualKioskAnswers"
       FROM survey_answers answer
       INNER JOIN survey_questions question ON question.id = answer.question_id
       WHERE answer.submission_id = $1
         AND LOWER(question.code) = ANY($2::text[])`,
      [submissionId, OFFICIAL_KIOSK_QUESTION_CODES],
    );
    expect(residualKioskAnswers).toBe(7);
    const [{ correctionAudits }] = await dataSource.query<
      Array<{ correctionAudits: number }>
    >(
      `SELECT COUNT(*)::integer AS "correctionAudits"
       FROM audit_logs
       WHERE action = 'KIOSK_APPLICABILITY_DATA_REPAIRED'
         AND entity_id = $1`,
      [submissionId],
    );
    expect(correctionAudits).toBe(1);

    const incorporatedSchool = request.agent(httpServer).set(csrfHeaders());
    await incorporatedSchool
      .post('/api/auth/login')
      .send({ email: 'new-school.e2e@example.com', password })
      .expect(200);
    const incorporatedCampaigns = await incorporatedSchool
      .get('/api/school/campaigns')
      .expect(200);
    expect(
      (incorporatedCampaigns.body as AvailableCampaignsBody).items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: campaignId, canStart: true }),
      ]),
    );
    const incorporatedSubmission = await incorporatedSchool
      .post(`/api/school/campaigns/${campaignId}/submission`)
      .expect(201);
    expect(
      (incorporatedSubmission.body as SubmissionWorkspaceBody).submission,
    ).toMatchObject({ status: 'draft', progress: { total: 53 } });
  }, 60_000);

  it('regresses imports, duplicates, configuration and rectification history', async () => {
    const httpServer = app.getHttpServer();
    const admin = request.agent(httpServer).set(csrfHeaders());
    const school = request.agent(httpServer).set(csrfHeaders());
    await admin
      .post('/api/auth/login')
      .send({ email: 'admin.e2e@example.com', password })
      .expect(200);
    await school
      .post('/api/auth/login')
      .send({ email: 'school.e2e@example.com', password })
      .expect(200);

    const schoolTemplate = await admin
      .get('/api/admin/schools/import/template')
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect('content-type', /text\/csv; charset=utf-8/)
      .expect('content-disposition', /plantilla-colegios\.csv/);
    const schoolTemplateBuffer = schoolTemplate.body as Buffer;
    expect(schoolTemplateBuffer.subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
    const schoolPreview = await admin
      .post('/api/admin/schools/import/preview')
      .attach('file', schoolTemplateBuffer, {
        filename: 'plantilla-colegios.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(schoolPreview.body as ImportSummaryBody).toMatchObject({
      totalRows: 1,
      validCount: 1,
      errorCount: 0,
    });
    const schoolImport = await admin
      .post('/api/admin/schools/import')
      .attach('file', schoolTemplateBuffer, {
        filename: 'plantilla-colegios.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(schoolImport.body as ImportSummaryBody).toMatchObject({
      totalRows: 1,
      importedCount: 1,
      errorCount: 0,
    });

    const userTemplate = await admin
      .get('/api/admin/users/import/template')
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect('content-type', /text\/csv; charset=utf-8/)
      .expect('content-disposition', /plantilla-usuarios\.csv/);
    const userTemplateBuffer = userTemplate.body as Buffer;
    expect(userTemplateBuffer.subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
    const userPreview = await admin
      .post('/api/admin/users/import/preview')
      .attach('file', userTemplateBuffer, {
        filename: 'plantilla-usuarios.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(userPreview.body as ImportSummaryBody).toMatchObject({
      totalRows: 2,
      validCount: 2,
      errorCount: 0,
    });
    const userImport = await admin
      .post('/api/admin/users/import')
      .attach('file', userTemplateBuffer, {
        filename: 'plantilla-usuarios.csv',
        contentType: 'text/csv',
      })
      .expect(201);
    expect(userImport.body as ImportSummaryBody).toMatchObject({
      totalRows: 2,
      importedCount: 2,
      errorCount: 0,
    });

    const duplicateUser = await admin
      .post('/api/admin/users')
      .send({
        firstName: 'Otra',
        lastName: 'Persona',
        email: 'MARIA.PEREZ@ESCUELA.EDU.AR',
        role: 'admin',
        temporaryPassword: 'OtraClave!2026',
      })
      .expect(409);
    expect(duplicateUser.body as StructuredConflictBody).toEqual({
      code: 'USER_EMAIL_CONFLICT',
      field: 'email',
      message: 'Ya existe un usuario con ese correo.',
    });
    const concurrentUserPayload = {
      firstName: 'Usuario',
      lastName: 'Concurrente',
      email: 'concurrente.e2e@example.com',
      role: 'admin',
      temporaryPassword: 'Concurrente!2026',
    };
    const concurrentResponses = await Promise.all([
      admin.post('/api/admin/users').send(concurrentUserPayload),
      admin.post('/api/admin/users').send(concurrentUserPayload),
    ]);
    expect(concurrentResponses.map(({ status }) => status).sort()).toEqual([
      201, 409,
    ]);
    const concurrentConflict = concurrentResponses.find(
      ({ status }) => status === 409,
    );
    expect(concurrentConflict?.body as StructuredConflictBody).toMatchObject({
      code: 'USER_EMAIL_CONFLICT',
      field: 'email',
    });

    const configurationOneInput = evaluationConfigurationInput(
      'v-e2e-create',
      'Configuración E2E uno',
    );
    const configurationTwoInput = evaluationConfigurationInput(
      'v-e2e-edit',
      'Configuración E2E dos',
    );
    const configurationOne = await admin
      .post('/api/admin/evaluation-configurations')
      .send(configurationOneInput)
      .expect(201);
    const configurationTwo = await admin
      .post('/api/admin/evaluation-configurations')
      .send(configurationTwoInput)
      .expect(201);
    const duplicateConfiguration = await admin
      .post('/api/admin/evaluation-configurations')
      .send(configurationOneInput)
      .expect(409);
    expect(duplicateConfiguration.body as StructuredConflictBody).toMatchObject(
      {
        code: 'EVALUATION_VERSION_CODE_CONFLICT',
        field: 'versionCode',
      },
    );
    const configurationTwoId = (configurationTwo.body as { id: string }).id;
    const duplicateOnEdit = await admin
      .patch(`/api/admin/evaluation-configurations/${configurationTwoId}`)
      .send(configurationOneInput)
      .expect(409);
    expect(duplicateOnEdit.body as StructuredConflictBody).toMatchObject({
      code: 'EVALUATION_VERSION_CODE_CONFLICT',
      field: 'versionCode',
    });
    const activeConfigurationId = (
      await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM evaluation_configurations WHERE status = 'active'`,
      )
    )[0].id;
    const duplicateOnClone = await admin
      .post(
        `/api/admin/evaluation-configurations/${activeConfigurationId}/clone`,
      )
      .send({ versionCode: configurationOneInput.versionCode })
      .expect(409);
    expect(duplicateOnClone.body as StructuredConflictBody).toMatchObject({
      code: 'EVALUATION_VERSION_CODE_CONFLICT',
      field: 'versionCode',
    });
    expect((configurationOne.body as { id: string }).id).toMatch(
      /^[a-f0-9-]{36}$/,
    );

    const profileBefore = await school.get('/api/schools/me').expect(200);
    const profileBeforeBody = profileBefore.body as SchoolPortalBody;
    expect(profileBeforeBody.rectifications).toHaveLength(1);
    expect(profileBeforeBody.rectifications[0].snapshot.schemaVersion).toBe(4);
    expect(profileBeforeBody.shiftCatalog).toMatchObject({ code: 'simple' });
    expect(profileBeforeBody.educationLevels).toEqual([
      expect.objectContaining({ code: 'primario' }),
    ]);
    if (!profileBeforeBody.shiftCatalog)
      throw new Error('La escuela E2E no tiene una jornada estructurada.');
    const rectificationPayload = {
      name: profileBeforeBody.name,
      cue: profileBeforeBody.cue,
      directorName: 'Dirección E2E rectificada',
      department: profileBeforeBody.department,
      address: profileBeforeBody.address,
      locality: profileBeforeBody.locality,
      managementType: profileBeforeBody.managementType,
      scope: profileBeforeBody.scope,
      educationLevel: profileBeforeBody.educationLevel,
      shiftCatalogId: profileBeforeBody.shiftCatalog.id,
      educationLevels: profileBeforeBody.educationLevels.map(
        ({ levelId, enrollment }) => ({ levelId, enrollment }),
      ),
      hasKiosk: profileBeforeBody.hasKiosk,
      hasFoodService: profileBeforeBody.hasFoodService,
      isBoarding: profileBeforeBody.isBoarding,
      expectedUpdatedAt: profileBeforeBody.updatedAt,
    };
    const rectified = await school
      .put('/api/schools/me/rectification')
      .send(rectificationPayload)
      .expect(200);
    const rectifiedBody = rectified.body as SchoolPortalBody;
    expect(rectifiedBody.directorName).toBe('Dirección E2E rectificada');
    expect(rectifiedBody.rectifications).toHaveLength(2);
    await school
      .put('/api/schools/me/rectification')
      .send(rectificationPayload)
      .expect(409);
    const [{ rectificationCount }] = await dataSource.query<
      Array<{ rectificationCount: number }>
    >(
      `SELECT COUNT(*)::integer AS "rectificationCount"
       FROM school_rectifications WHERE school_id = $1`,
      [primarySchoolId],
    );
    expect(rectificationCount).toBe(2);
  }, 60_000);

  async function seedProductOneCycle() {
    const passwordHash = await bcrypt.hash(password, 4);
    await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO users
         (first_name, last_name, email, password_hash, role, is_active, must_change_password)
       VALUES ('Admin', 'E2E', 'admin.e2e@example.com', $1, 'admin', true, false)
       RETURNING id`,
      [passwordHash],
    );
    const [{ id: schoolUserId }] = await dataSource.query<
      Array<{ id: string }>
    >(
      `INSERT INTO users
         (first_name, last_name, email, password_hash, role, is_active, must_change_password)
       VALUES ('Escuela', 'E2E', 'school.e2e@example.com', $1, 'school', true, false)
       RETURNING id`,
      [passwordHash],
    );
    const [{ id: secondarySchoolUserId }] = await dataSource.query<
      Array<{ id: string }>
    >(
      `INSERT INTO users
         (first_name, last_name, email, password_hash, role, is_active, must_change_password)
       VALUES ('Escuela', 'Nueva E2E', 'new-school.e2e@example.com', $1, 'school', true, false)
       RETURNING id`,
      [passwordHash],
    );
    primarySchoolId = await insertSchool('E2E-0001', 'Capital');
    secondarySchoolId = await insertSchool('E2E-0002', 'Godoy Cruz');
    await dataSource.query(
      `INSERT INTO user_schools (user_id, school_id) VALUES ($1, $2)`,
      [schoolUserId, primarySchoolId],
    );
    await dataSource.query(
      `INSERT INTO user_schools (user_id, school_id) VALUES ($1, $2)`,
      [secondarySchoolUserId, secondarySchoolId],
    );
    const [{ id: shiftCatalogId, code: shiftCode, label: shiftLabel }] =
      await dataSource.query<
        Array<{ id: string; code: string; label: string }>
      >(
        `SELECT id, code, label
         FROM school_shift_catalogs
         WHERE code = 'simple' AND is_active = true`,
      );
    const [{ id: levelId, code: levelCode, label: levelLabel }] =
      await dataSource.query<
        Array<{ id: string; code: string; label: string }>
      >(
        `SELECT id, code, label
         FROM education_level_catalogs
         WHERE code = 'primario' AND is_active = true`,
      );
    await insertInitialRectification({
      schoolId: primarySchoolId,
      actorUserId: schoolUserId,
      cue: 'E2E-0001',
      name: 'Escuela E2E Capital',
      department: 'Capital',
      shiftCatalogId,
      shiftCode,
      shiftLabel,
      levelId,
      levelCode,
      levelLabel,
    });
    await insertInitialRectification({
      schoolId: secondarySchoolId,
      actorUserId: secondarySchoolUserId,
      cue: 'E2E-0002',
      name: 'Escuela E2E-0002',
      department: 'Godoy Cruz',
      shiftCatalogId,
      shiftCode,
      shiftLabel,
      levelId,
      levelCode,
      levelLabel,
    });

    const [{ id: surveyId }] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO surveys (code, name, description, is_active)
       VALUES ('producto-1-e2e', 'Cuestionario Producto 1 E2E', 'Prueba integral', true)
       RETURNING id`,
    );
    [{ id: surveyVersionId }] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO survey_versions
         (survey_id, version_number, title, instructions, status, published_at)
       VALUES ($1, 1, 'Versión E2E', 'Responder todas las preguntas aplicables.', 'draft', NULL)
       RETURNING id`,
      [surveyId],
    );

    for (const dimension of OFFICIAL_SURVEY_DIMENSIONS) {
      const [{ id: dimensionId }] = await dataSource.query<
        Array<{ id: string }>
      >(
        `INSERT INTO survey_dimensions
           (version_id, code, title, description, "order")
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          surveyVersionId,
          dimension.code,
          dimension.title,
          dimension.description,
          dimension.order,
        ],
      );
      const [{ id: sectionId }] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO survey_sections
           (dimension_id, code, title, description, "order")
         VALUES ($1, $2, $3, NULL, 1)
         RETURNING id`,
        [
          dimensionId,
          `section-${dimension.order}`,
          `Sección ${dimension.order}`,
        ],
      );
      const firstQuestionNumber = (dimension.order - 1) * 10 + 1;
      for (
        let questionNumber = firstQuestionNumber;
        questionNumber < firstQuestionNumber + 10;
        questionNumber += 1
      ) {
        const questionCode = `p${String(questionNumber).padStart(3, '0')}`;
        const kioskConditional = questionNumber >= 21 && questionNumber <= 27;
        const answer = await insertQuestion(
          sectionId,
          questionCode,
          questionNumber - firstQuestionNumber + 1,
          kioskConditional,
        );
        if (!kioskConditional) baseAnswers.push(answer);
      }
    }

    await dataSource.query(
      `UPDATE survey_versions
       SET status = 'published', published_at = now()
       WHERE id = $1`,
      [surveyVersionId],
    );
  }

  async function insertSchool(cue: string, department: string) {
    const [{ id: shiftCatalogId, label: shiftLabel }] = await dataSource.query<
      Array<{ id: string; label: string }>
    >(
      `SELECT id, label
         FROM school_shift_catalogs
         WHERE code = 'simple' AND is_active = true`,
    );
    const [{ id: levelId }] = await dataSource.query<Array<{ id: string }>>(
      `SELECT id
       FROM education_level_catalogs
       WHERE code = 'primario' AND is_active = true`,
    );
    const [{ id }] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO schools
         (cue, name, director_name, school_number, department, locality,
          address, education_level, management_type, scope, shift, shift_catalog_id,
          referent_first_name, referent_last_name, has_kiosk, has_food_service,
          is_boarding, characteristics, is_active)
       VALUES ($1, $2, 'Dirección E2E', $1, $3, 'Mendoza', 'Calle E2E 1',
          'Educación común', 'Estatal', 'Urbano', $4, $5,
          'Referente', 'E2E', false, false, false,
          '{"isMultigrade": false, "isInterculturalBilingual": false}'::jsonb,
          true)
       RETURNING id`,
      [cue, `Escuela ${cue}`, department, shiftLabel, shiftCatalogId],
    );
    await dataSource.query(
      `INSERT INTO school_education_levels
         (school_id, level_id, enrollment, "order")
       VALUES ($1, $2, NULL, 0)`,
      [id, levelId],
    );
    return id;
  }

  async function insertInitialRectification(input: {
    schoolId: string;
    actorUserId: string;
    cue: string;
    name: string;
    department: string;
    shiftCatalogId: string;
    shiftCode: string;
    shiftLabel: string;
    levelId: string;
    levelCode: string;
    levelLabel: string;
  }) {
    const rectificationId = randomUUID();
    const capturedAt = new Date();
    const snapshot = {
      schemaVersion: 4,
      sourceRectificationId: rectificationId,
      capturedAt: capturedAt.toISOString(),
      name: input.name,
      cue: input.cue,
      directorName: 'Dirección E2E',
      department: input.department,
      address: 'Calle E2E 1',
      locality: 'Mendoza',
      managementType: 'Estatal',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      shift: input.shiftLabel,
      hasKiosk: false,
      hasFoodService: false,
      isBoarding: false,
      characteristics: {
        isMultigrade: false,
        isInterculturalBilingual: false,
      },
      shiftCatalog: {
        id: input.shiftCatalogId,
        code: input.shiftCode,
        label: input.shiftLabel,
      },
      educationLevels: [
        {
          id: input.levelId,
          code: input.levelCode,
          label: input.levelLabel,
          enrollment: null,
        },
      ],
      enrollmentTotal: null,
      contacts: [],
    };
    await dataSource.query(
      `INSERT INTO school_rectifications
         (id, school_id, period_year, actor_user_id, snapshot, rectified_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        rectificationId,
        input.schoolId,
        mendozaYear(),
        input.actorUserId,
        JSON.stringify(snapshot),
        capturedAt,
      ],
    );
    await dataSource.query(
      `INSERT INTO school_rectification_education_levels
         (rectification_id, level_id, level_code, level_label, enrollment, "order")
       VALUES ($1, $2, $3, $4, NULL, 0)`,
      [rectificationId, input.levelId, input.levelCode, input.levelLabel],
    );
  }

  async function insertQuestion(
    sectionId: string,
    code: string,
    order: number,
    kioskConditional: boolean,
  ) {
    const [{ id: questionId }] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO survey_questions
         (section_id, code, type, prompt, required, "order", validation)
       VALUES ($1, $2, 'single_choice', $3, true, $4, '{}'::jsonb)
       RETURNING id`,
      [sectionId, code, `Pregunta ${code}`, order],
    );
    const [{ id: optionId }] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO survey_options
         (question_id, value, label, score, "order")
       VALUES ($1, 'si', 'Sí', 100, 1)
       RETURNING id`,
      [questionId],
    );
    if (kioskConditional) {
      const [{ id: ruleId }] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO survey_applicability_rules
           (question_id, group_operator, action, default_action, "order")
         VALUES ($1, 'all', 'show', 'omit', 0)
         RETURNING id`,
        [questionId],
      );
      await dataSource.query(
        `INSERT INTO survey_applicability_conditions
           (rule_id, feature, operator, expected_value, "order")
         VALUES ($1, 'has_kiosk', 'equals', 'true'::jsonb, 0)`,
        [ruleId],
      );
    }
    return { questionId, optionId };
  }
});

function campaignDates() {
  return {
    startDate: mendozaDate(-1),
    endDate: mendozaDate(7),
  };
}

function mendozaDate(offsetDays: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Mendoza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

function mendozaYear() {
  return Number(mendozaDate(0).slice(0, 4));
}

function evaluationConfigurationInput(versionCode: string, name: string) {
  return {
    versionCode,
    name,
    description: 'Configuración sintética para regresión E2E.',
    mentalHealthCriticalThreshold: 33,
    mentalHealthMaxStars: 4,
    starRanges: [
      {
        stars: 1,
        lowerBound: 0,
        upperBound: 20,
        lowerInclusive: true,
        upperInclusive: true,
        order: 1,
      },
      ...[2, 3, 4, 5].map((stars) => ({
        stars,
        lowerBound: (stars - 1) * 20,
        upperBound: stars * 20,
        lowerInclusive: false,
        upperInclusive: true,
        order: stars,
      })),
    ],
  };
}

function binaryParser(
  response: IncomingMessage,
  callback: (error: Error | null, body?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

function csrfHeaders(): Record<string, string> {
  return {
    Origin: parseFrontendOrigin(
      process.env.FRONTEND_URL ?? 'http://localhost:5173',
    ),
    'X-CSRF-Protection': '1',
  };
}

import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { PassThrough, Writable } from 'node:stream';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { CampaignParticipationStatus } from '../../campaigns/dto/list-campaign-tracking-query.dto';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { EvaluationSnapshot } from '../../evaluation/evaluation-snapshot.type';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { OfficialSurveyDimensionCode } from '../../surveys/templates/official-survey-dimensions.template';
import { UserRole } from '../../users/entities/user-role.enum';
import { AdminExportsService } from './admin-exports.service';

const campaignId = '20000000-0000-4000-8000-000000000001';
const actor: AuthenticatedUser = {
  id: '30000000-0000-4000-8000-000000000001',
  email: 'admin@example.com',
  role: UserRole.Admin,
  mustChangePassword: false,
};

describe('AdminExportsService XLSX', () => {
  it('aplica en la exportación los mismos filtros multiselección del dashboard', async () => {
    const { service, builder } = fixture([]);
    const response = new PassThrough();
    response.on('data', () => undefined);
    const expressResponse = response as unknown as Response;
    expressResponse.setHeader = jest.fn(() => expressResponse);

    await service.write(
      'results',
      {
        campaignId,
        format: 'csv',
        departments: ['Capital', 'Lavalle'],
        educationLevels: ['primario', 'secundario'],
        submissionStatuses: [
          CampaignParticipationStatus.NotStarted,
          CampaignParticipationStatus.Submitted,
        ],
        stars: [3, 4],
        criticalAreas: [OfficialSurveyDimensionCode.MentalHealth],
      },
      actor,
      expressResponse,
    );

    expect(builder.andWhere).toHaveBeenCalledWith(
      'school.department IN (:...departments)',
      { departments: ['Capital', 'Lavalle'] },
    );
    expect(
      builder.andWhere.mock.calls.some(([condition]) =>
        String(condition).includes('school_education_levels'),
      ),
    ).toBe(true);
    expect(builder.andWhere).toHaveBeenCalledWith(
      '(submission.id IS NULL OR submission.status IN (:...submissionStatuses))',
      { submissionStatuses: [CampaignParticipationStatus.Submitted] },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'evaluation.stars IN (:...stars)',
      { stars: [3, 4] },
    );
    expect(
      builder.andWhere.mock.calls.some(([condition]) =>
        String(condition).includes('dashboard_critical_dimension'),
      ),
    ).toBe(true);
  });

  it.each([0, 1, 205])(
    'genera un XLSX de resultados íntegro con %i presentaciones',
    async (presentationCount) => {
      const { service, audits } = fixture(
        Array.from({ length: presentationCount }, (_, index) =>
          exportRow(index, null),
        ),
      );
      const { buffer, headers } = await download(service, 'results');

      await expectValidWorkbook(buffer, 'Resultados', presentationCount + 1);
      expect(headers.get('content-type')).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expectAudit(audits, 'ADMIN_EXPORT_COMPLETED', {
        rowCount: presentationCount,
      });
    },
  );

  it.each([0, 1, 205])(
    'genera un XLSX de respuestas íntegro con %i presentaciones',
    async (presentationCount) => {
      const { service, audits } = fixture(
        Array.from({ length: presentationCount }, (_, index) =>
          exportRow(index, answerSnapshot(index)),
        ),
      );
      const { buffer } = await download(service, 'answers');

      await expectValidWorkbook(buffer, 'Respuestas', presentationCount + 1);
      expectAudit(audits, 'ADMIN_EXPORT_COMPLETED', {
        rowCount: presentationCount,
      });
    },
  );

  it('includes numerator, denominator and excluded kiosk questions in CSV', async () => {
    const snapshot = answerSnapshot(1);
    snapshot.result = {
      generalScore: '80',
      numerator: '400',
      denominator: 5,
      stars: {
        value: 4,
        ruleVersion: 'v1',
        blockingReasons: [],
        alerts: [],
      },
    };
    snapshot.survey.dimensions[0].sections[0].questions.push({
      ...snapshot.survey.dimensions[0].sections[0].questions[0],
      code: 'p021',
      answer: null,
      scoreUsed: null,
      applicability: {
        status: 'excluded',
        reasonDescription: 'La escuela no posee kiosco.',
      },
    } as never);
    const { service } = fixture([exportRow(1, snapshot)]);

    const results = await downloadCsv(service, 'results');
    const answers = await downloadCsv(service, 'answers');

    expect(results.buffer.subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
    expect(results.buffer.toString('utf8')).toContain(
      '"Puntaje general","Numerador general","Denominador general","Estrellas"',
    );
    expect(results.buffer.toString('utf8')).toContain(
      '"Tipo de educación","Niveles educativos"',
    );
    expect(results.buffer.toString('utf8')).toContain(
      '"Educación común","Primario [primario]"',
    );
    expect(results.buffer.toString('utf8')).toContain('"80","400","5","4"');
    expect(answers.buffer.toString('utf8')).toContain(
      '"p021","¿Pregunta?","","","No","Sí","La escuela no posee kiosco."',
    );
    expect(results.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  });

  it('preserves nulls, alerts and exclusions in workbooks read by ExcelJS', async () => {
    const snapshot = answerSnapshot(1);
    snapshot.result.stars.alerts = [
      { code: 'MENTAL_HEALTH_CRITICAL', message: 'Alerta crítica E2E' },
    ];
    snapshot.survey.dimensions[0].sections[0].questions.push({
      ...snapshot.survey.dimensions[0].sections[0].questions[0],
      code: 'p021',
      answer: null,
      scoreUsed: null,
      applicability: {
        status: 'excluded',
        reasonDescription: 'La escuela no posee kiosco.',
      },
    } as never);
    const { service } = fixture([exportRow(0, null), exportRow(1, snapshot)]);

    const results = await download(service, 'results');
    const resultWorkbook = new ExcelJS.Workbook();
    await resultWorkbook.xlsx.load(results.buffer as unknown as ArrayBuffer);
    const resultSheet = resultWorkbook.getWorksheet('Resultados');
    expect(resultSheet?.columnCount).toBe(27);
    expect(resultSheet?.getRow(1).cellCount).toBe(27);
    expect(resultSheet?.getRow(2).cellCount).toBe(27);
    expect(resultSheet?.getCell('C2').text).toBe('Capital');
    expect(resultSheet?.getCell('D2').text).toBe('Mendoza');
    expect(resultSheet?.getCell('E2').text).toBe('Educación común');
    expect(resultSheet?.getCell('F2').text).toBe('Primario [primario]');
    expect(resultSheet?.getCell('G2').text).toBe('Estatal');
    expect(resultSheet?.getCell('R2').value).toBeNull();
    expect(resultSheet?.getCell('X3').text).toContain('Alerta crítica E2E');

    const answers = await download(service, 'answers');
    const answerWorkbook = new ExcelJS.Workbook();
    await answerWorkbook.xlsx.load(answers.buffer as unknown as ArrayBuffer);
    const answerSheet = answerWorkbook.getWorksheet('Respuestas');
    expect(answerSheet?.columnCount).toBe(14);
    expect(answerSheet?.getRow(1).cellCount).toBe(14);
    expect(answerSheet?.getRow(2).cellCount).toBe(14);
    const excludedRow = answerSheet
      ?.getRows(2, answerSheet.rowCount - 1)
      ?.find((row) => row.getCell(8).text === 'p021');
    expect(excludedRow?.getCell(12).text).toBe('No');
    expect(excludedRow?.getCell(13).text).toBe('Sí');
    expect(excludedRow?.getCell(14).text).toBe('La escuela no posee kiosco.');
  });

  it('propagates a client disconnection and records a failed export', async () => {
    const { service, audits } = fixture([exportRow(1, answerSnapshot(1))]);
    const response = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('client disconnected'));
      },
    }) as unknown as Response;
    response.setHeader = jest.fn(() => response);

    await expect(
      service.write('results', { campaignId, format: 'xlsx' }, actor, response),
    ).rejects.toThrow('client disconnected');
    expectAudit(audits, 'ADMIN_EXPORT_FAILED', { outcome: 'failed' });
  });

  it.each(['xlsx', 'csv'] as const)(
    'closes a partial %s response when the database fails',
    async (format) => {
      const { service, audits, builder } = fixture([
        exportRow(1, answerSnapshot(1)),
      ]);
      builder.getRawMany.mockRejectedValueOnce(
        new Error('database unavailable'),
      );
      const response = new PassThrough();
      response.on('error', () => undefined);
      const expressResponse = response as unknown as Response;
      expressResponse.setHeader = jest.fn(() => expressResponse);

      await expect(
        service.write(
          'results',
          { campaignId, format },
          actor,
          expressResponse,
        ),
      ).rejects.toThrow('database unavailable');
      expect(response.destroyed).toBe(true);
      expectAudit(audits, 'ADMIN_EXPORT_FAILED', { outcome: 'failed' });
    },
  );
});

async function download(
  service: AdminExportsService,
  kind: 'results' | 'answers',
) {
  const response = new PassThrough();
  const headers = new Map<string, string>();
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const expressResponse = response as unknown as Response;
  expressResponse.setHeader = (
    name: string,
    value: string | number | readonly string[],
  ) => {
    headers.set(name.toLowerCase(), String(value));
    return expressResponse;
  };

  await service.write(
    kind,
    { campaignId, format: 'xlsx' },
    actor,
    expressResponse,
  );
  return { buffer: Buffer.concat(chunks), headers };
}

async function downloadCsv(
  service: AdminExportsService,
  kind: 'results' | 'answers',
) {
  const response = new PassThrough();
  const headers = new Map<string, string>();
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const expressResponse = response as unknown as Response;
  expressResponse.setHeader = (
    name: string,
    value: string | number | readonly string[],
  ) => {
    headers.set(name.toLowerCase(), String(value));
    return expressResponse;
  };
  await service.write(
    kind,
    { campaignId, format: 'csv' },
    actor,
    expressResponse,
  );
  return { buffer: Buffer.concat(chunks), headers };
}

async function expectValidWorkbook(
  buffer: Buffer,
  worksheetName: string,
  expectedRows: number,
) {
  expect(buffer.length).toBeGreaterThan(49);
  expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  expect(buffer.subarray(-22, -18).toString('hex')).toBe('504b0506');
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
  expect(archive.file('[Content_Types].xml')).not.toBeNull();
  const workbookXml = await archive.file('xl/workbook.xml')?.async('text');
  expect(workbookXml).toContain(`name="${worksheetName}"`);
  const worksheetXml = await archive
    .file('xl/worksheets/sheet1.xml')
    ?.async('text');
  expect(worksheetXml?.match(/<row\b/g) ?? []).toHaveLength(expectedRows);
}

function fixture(rows: Array<Record<string, unknown>>) {
  const audits: Array<Record<string, unknown>> = [];
  const builder = chainableBuilder(rows);
  const campaignRepository = {
    findOneBy: jest.fn().mockResolvedValue({
      id: campaignId,
      name: 'Campaña de prueba',
    }),
  };
  const auditRepository = {
    save: jest.fn((audit: Record<string, unknown>) => {
      const saved = { ...audit, id: `audit-${audits.length + 1}` };
      audits.push(saved);
      return Promise.resolve(saved);
    }),
  };
  const assignmentRepository = {
    createQueryBuilder: jest.fn(() => builder),
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Campaign) return campaignRepository;
      if (entity === AuditLog) return auditRepository;
      if (entity === CampaignSchool) return assignmentRepository;
      throw new Error('Repositorio inesperado en la prueba.');
    }),
  };
  return {
    service: new AdminExportsService(dataSource as unknown as DataSource),
    audits,
    builder,
  };
}

function expectAudit(
  audits: Array<Record<string, unknown>>,
  action: string,
  expectedChanges: Record<string, unknown>,
) {
  const audit = audits.at(-1);
  expect(audit?.action).toBe(action);
  expect(audit?.changes).toMatchObject(expectedChanges);
}

function chainableBuilder(rows: Array<Record<string, unknown>>) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'innerJoin',
    'leftJoin',
    'where',
    'andWhere',
    'select',
    'addSelect',
    'orderBy',
    'addOrderBy',
  ])
    builder[method] = jest.fn(() => builder);
  let limit = 100;
  let offset = 0;
  builder.limit = jest.fn((value: number) => {
    limit = value;
    return builder;
  });
  builder.offset = jest.fn((value: number) => {
    offset = value;
    return builder;
  });
  builder.getRawMany = jest.fn(() =>
    Promise.resolve(rows.slice(offset, offset + limit)),
  );
  return builder;
}

function exportRow(index: number, snapshot: EvaluationSnapshot | null) {
  return {
    assignmentId: `assignment-${index}`,
    cue: `CUE-${index}`,
    schoolName: `Escuela ${index}`,
    department: 'Capital',
    locality: 'Mendoza',
    educationLevel: 'Educación común',
    educationLevels: 'Primario [primario]',
    managementType: 'Estatal',
    scope: 'Urbano',
    shift: 'Mañana',
    campaignName: 'Campaña de prueba',
    submissionStatus: SubmissionStatus.Submitted,
    submittedAt: '2026-08-10T12:00:00.000Z',
    generalScore: snapshot?.result.generalScore ?? '75',
    stars: snapshot?.result.stars.value ?? 4,
    snapshot,
  };
}

function answerSnapshot(index: number): EvaluationSnapshot {
  return {
    schemaVersion: 2,
    algorithm: {
      version: 'evaluation-v1',
      calculatedAt: '2026-08-10T12:00:01.000Z',
    },
    result: {
      generalScore: '100',
      numerator: '100',
      denominator: 1,
      stars: {
        value: 5,
        ruleVersion: 'v1',
        blockingReasons: [],
        alerts: [],
      },
    },
    submission: {
      id: `submission-${index}`,
      campaignId,
      schoolId: `school-${index}`,
      surveyVersionId: 'version-id',
      schoolRectificationId: null,
      submittedAt: '2026-08-10T12:00:00.000Z',
      originalRespondent: {
        id: actor.id,
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
      },
    },
    school: {
      name: `Escuela ${index}`,
      cue: `CUE-${index}`,
      directorName: 'Dirección',
      address: 'Calle 1',
      locality: 'Mendoza',
      scope: 'Urbano',
      educationLevel: 'Primario',
      shift: 'Mañana',
    },
    survey: {
      id: 'survey-id',
      code: 'institucional',
      name: 'Cuestionario institucional',
      description: null,
      version: { number: 1 },
      dimensions: [
        {
          code: 'compromiso_institucional',
          title: 'Compromiso Institucional',
          order: 0,
          result: { score: '100' },
          sections: [
            {
              questions: [
                {
                  code: `p${index}`,
                  prompt: '¿Pregunta?',
                  answer: {
                    value: null,
                    selectedOption: { label: 'Sí' },
                  },
                  scoreUsed: '100',
                  applicability: {
                    status: 'applicable',
                    reasonDescription: 'Aplicable.',
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as EvaluationSnapshot;
}

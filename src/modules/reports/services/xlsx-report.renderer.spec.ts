import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { EvaluationQuestionSnapshot } from '../../evaluation/evaluation-snapshot.type';
import type { IndividualReportViewModel } from '../report.types';
import { XlsxReportRenderer } from './xlsx-report.renderer';

describe('XlsxReportRenderer', () => {
  const renderer = new XlsxReportRenderer();

  it('genera un ZIP/XLSX íntegro con envío, resultado y 60 preguntas históricas', async () => {
    const buffer = await renderer.report(reportView());

    expect(buffer.byteLength).toBeGreaterThan(5_000);
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(buffer.subarray(-22, -18).toString('hex')).toBe('504b0506');
    const archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
    expect(archive.file('[Content_Types].xml')).not.toBeNull();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map(({ name }) => name)).toEqual([
      'Resumen',
      'Dimensiones',
      'Respuestas',
      'Exclusiones',
    ]);
    expect(workbook.getWorksheet('Dimensiones')?.rowCount).toBe(2);
    expect(workbook.getWorksheet('Respuestas')?.rowCount).toBe(56);
    expect(workbook.getWorksheet('Exclusiones')?.rowCount).toBe(6);
    expect(headers(workbook, 'Resumen')).toEqual([
      'Sección',
      'Dato',
      'Valor histórico',
    ]);
    expect(headers(workbook, 'Dimensiones')).toEqual([
      'Código',
      'Dimensión',
      'Numerador',
      'Denominador',
      'Puntaje',
      'Área crítica',
      'Valor observado',
      'Umbral',
      'Regla',
    ]);
    expect(headers(workbook, 'Respuestas')).toEqual([
      'Código dimensión',
      'Dimensión',
      'Código sección',
      'Sección',
      'Código pregunta',
      'Texto histórico',
      'Obligatoria',
      'Respuesta declarada',
      'Puntaje utilizado',
      'Estado',
    ]);
    expect(headers(workbook, 'Exclusiones')).toEqual([
      'Código dimensión',
      'Dimensión',
      'Código sección',
      'Sección',
      'Código pregunta',
      'Texto histórico',
      'Obligatoria',
      'Código del motivo',
      'Motivo de exclusión',
    ]);
  });

  it('neutraliza fórmulas, conserva tildes y no revela respuestas residuales excluidas', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await renderer.report(reportView());
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const cells = workbook.worksheets.flatMap(
      (sheet) =>
        sheet
          .getRows(1, sheet.rowCount)
          ?.flatMap((row) =>
            Array.from(
              { length: row.cellCount },
              (_, index) => row.getCell(index + 1).text,
            ),
          ) ?? [],
    );

    expect(cells).toContain('\'=HYPERLINK("https://example.test")');
    expect(cells).toContain("'+Pregunta histórica con tildes: alimentación");
    expect(cells).toContain("'-2+3");
    expect(cells).toContain("'@Sección importada");
    expect(cells).toContain("'=Motivo histórico");
    expect(cells.join('\n')).not.toContain('RESPUESTA RESIDUAL SECRETA');
  });

  it('distingue estrellas base/finales y presenta fechas civiles de Mendoza', async () => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await renderer.report(reportView());
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const summary = workbook.getWorksheet('Resumen');
    const rows = summary?.getRows(2, (summary?.rowCount ?? 1) - 1) ?? [];
    const valueByLabel = new Map(
      rows.map((row) => [row.getCell(2).text, row.getCell(3).text]),
    );

    expect(valueByLabel.get('Período')).toBe('01/01/2026 al 31/08/2026');
    expect(valueByLabel.get('Fecha (Mendoza)')).toBe(
      '10/08/2026 09:00:00 (Mendoza)',
    );
    expect(valueByLabel.get('Estrellas base')).toBe('5');
    expect(valueByLabel.get('Estrellas finales')).toBe('4');
    expect(valueByLabel.get('Tipo de educación')).toBe('Educación común');
    expect(valueByLabel.get('Director/a')).toBe('Dirección de prueba');
    expect(valueByLabel.get('Niveles educativos')).toBe(
      'Primario [primario] - matrícula: 125',
    );
  });

  it('conserva un workbook válido con valores opcionales y listas vacías', async () => {
    const view = reportView();
    view.school.educationLevels = [];
    view.result.stars.value = null;
    view.result.stars.baseValue = null;
    view.result.stars.alerts = [];
    view.result.stars.blockingReasons = [];
    view.survey.dimensions[0].sections[0].questions = [];

    const buffer = await renderer.report(view);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const summary = workbook.getWorksheet('Resumen');
    const rows = summary?.getRows(2, (summary?.rowCount ?? 1) - 1) ?? [];
    const valueByLabel = new Map(
      rows.map((row) => [row.getCell(2).text, row.getCell(3).text]),
    );

    expect(workbook.getWorksheet('Respuestas')?.rowCount).toBe(1);
    expect(workbook.getWorksheet('Exclusiones')?.rowCount).toBe(1);
    expect(valueByLabel.get('Niveles educativos')).toBe(
      'Sin datos estructurados',
    );
    expect(valueByLabel.get('Estrellas finales')).toBe('Sin clasificación');
    expect(valueByLabel.get('Alertas')).toBe('Sin alertas');
    expect(valueByLabel.get('Bloqueos de certificación')).toBe('Sin bloqueos');
  });
});

function headers(workbook: ExcelJS.Workbook, worksheetName: string) {
  const worksheet = workbook.getWorksheet(worksheetName);
  return Array.from(
    { length: worksheet?.columnCount ?? 0 },
    (_, index) => worksheet?.getRow(1).getCell(index + 1).text,
  );
}

function reportView(): IndividualReportViewModel {
  const questions = Array.from({ length: 60 }, (_, index) =>
    question(index, index >= 55),
  );
  return {
    school: {
      name: '=HYPERLINK("https://example.test")',
      cue: '5000000',
      schoolNumber: '1-001',
      directorName: 'Dirección de prueba',
      department: 'Godoy Cruz',
      address: 'Calle de prueba 1',
      postalCode: '5501',
      locality: 'Mendoza',
      managementType: 'Estatal',
      scope: 'Urbano',
      educationLevel: 'Educación común',
      educationLevels: [
        {
          id: 'level-id',
          code: 'primario',
          label: 'Primario',
          enrollment: 125,
        },
      ],
      shift: 'Mañana',
      shiftCatalog: {
        id: 'shift-id',
        code: 'manana',
        label: 'Mañana',
      },
      phone: '+54 261 555-0101',
      email: 'escuela@example.com',
    },
    campaign: {
      id: 'campaign-id',
      name: 'Campaña 2026',
      startsAt: '2026-01-01T03:00:00.000Z',
      endsAt: '2026-09-01T02:59:59.999Z',
    },
    survey: {
      id: 'survey-id',
      code: 'EPS',
      name: 'Escuelas Promotoras de Salud',
      description: null,
      version: {
        id: 'version-id',
        number: 3,
        title: 'Versión histórica 2026',
        instructions: null,
        publishedAt: '2026-01-01T12:00:00.000Z',
      },
      dimensions: [
        {
          id: 'dimension-id',
          code: 'alimentacion_saludable',
          title: 'Alimentación saludable',
          description: null,
          order: 1,
          result: {
            numerator: '80.00',
            denominator: 100,
            score: '80.00',
            criticality: null,
          },
          sections: [
            {
              id: 'section-id',
              code: 'section-code',
              title: '@Sección importada',
              description: null,
              order: 1,
              questions,
            },
          ],
        },
      ],
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
    result: {
      generalScore: '80.00',
      numerator: '480.00',
      denominator: 6,
      stars: {
        value: 4,
        baseValue: 5,
        ruleVersion: 'stars-v3',
        blockingReasons: ['Salud mental crítica'],
        alerts: [{ message: '@Alerta crítica' }],
      },
    },
    algorithm: {
      version: 'evaluation-v3',
      calculatedAt: '2026-08-10T12:00:01.000Z',
    },
    branding: {
      programName: 'Escuelas Promotoras de Salud',
      organizations: 'Gobierno de Mendoza · OPS/OMS',
      logos: [],
      signer: null,
      signerPosition: null,
      signatureImage: null,
      legalText: null,
      verificationUrl: null,
    },
    radarSvg: '',
  };
}

function question(
  index: number,
  excluded: boolean,
): EvaluationQuestionSnapshot {
  const code = `P${String(index + 1).padStart(2, '0')}`;
  return {
    id: `question-${index}`,
    code,
    type: 'single_choice',
    prompt:
      index === 0
        ? '+Pregunta histórica con tildes: alimentación'
        : `Pregunta histórica ${index + 1}: ${'texto extenso '.repeat(12)}`,
    helpText: null,
    required: true,
    order: index + 1,
    validation: {},
    options: [],
    rules: [],
    applicability: {
      status: excluded ? 'excluded' : 'applicable',
      reasonCode: excluded ? 'NO_APLICA' : null,
      reasonDescription: excluded ? '=Motivo histórico' : null,
      matchedRuleId: null,
      evaluatedAt: '2026-08-10T12:00:00.000Z',
      relevantSchoolFacts: {},
    },
    answer: excluded
      ? {
          id: `answer-${index}`,
          optionId: null,
          value: 'RESPUESTA RESIDUAL SECRETA',
          selectedOption: null,
        }
      : {
          id: `answer-${index}`,
          optionId: null,
          value: index === 0 ? '-2+3' : `Respuesta ${index + 1}`,
          selectedOption: null,
        },
    scoreUsed: excluded ? null : '100.00',
  };
}

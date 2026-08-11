import ExcelJS from 'exceljs';
import path from 'node:path';
import {
  OFFICIAL_GENERAL_BINARY_QUESTION_CODES,
  OFFICIAL_GENERAL_SCORE_PROFILE,
  OFFICIAL_GENERAL_TERNARY_QUESTION_CODES,
  OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES,
  OFFICIAL_MENTAL_HEALTH_RESOLVED_QUESTION_CODE,
  OFFICIAL_MENTAL_HEALTH_RESOLVED_SCORE_SEQUENCE,
  OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE,
  OFFICIAL_UNRESOLVED_P038_CODE,
  getApprovedOfficialQuestionScoreSequence,
} from '../policies/official-survey-scoring.policy';

const workbookPath = path.resolve(
  __dirname,
  '../../../../docs/plantilla-cuestionario-completo.xlsx',
);

type WorkbookRow = Record<string, string>;

describe('Planilla consolidada del cuestionario institucional', () => {
  let workbook: ExcelJS.Workbook;
  let questionnaireRows: WorkbookRow[];
  let sourceRows: WorkbookRow[];
  let scoreMappingRows: WorkbookRow[];

  beforeAll(async () => {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    questionnaireRows = rowsFrom(workbook.getWorksheet('Cuestionario'));
    sourceRows = rowsFrom(workbook.getWorksheet('Fuente'));
    scoreMappingRows = rowsFrom(workbook.getWorksheet('Mapeo de puntajes'));
  });

  it('contiene exactamente 60 preguntas obligatorias, consecutivas y distribuidas en seis dimensiones', () => {
    const questionCodes = new Set(
      questionnaireRows.map((row) => row.pregunta_codigo),
    );
    const dimensionCodes = new Set(
      questionnaireRows.map((row) => row.dimension_codigo),
    );

    expect(questionCodes).toEqual(
      new Set(
        Array.from(
          { length: 60 },
          (_, index) => `p${String(index + 1).padStart(3, '0')}`,
        ),
      ),
    );
    expect(dimensionCodes.size).toBe(6);
    expect(questionnaireRows.every((row) => row.obligatoria === 'si')).toBe(
      true,
    );
  });

  it('incorpora las correcciones textuales cerradas en las respuestas funcionales finales', () => {
    const p010 = rowsForQuestion(questionnaireRows, 'p010');
    expect(p010[0].pregunta).toContain(
      'al menos 10 minutos para desayunos y meriendas, y 30 minutos para almuerzos',
    );
    expect(p010[0].opcion).toBe(
      'Se garantiza sistemáticamente 10 minutos para desayuno/merienda y 30 minutos para almuerzo.',
    );
    expect(p010.some((row) => row.opcion.includes('≥20 min'))).toBe(false);

    const p032 = rowsForQuestion(questionnaireRows, 'p032');
    expect(p032[0].pregunta).toBe(
      'Inclusión diaria de frutas y/o verduras frescas, crudas y preferentemente de estación.',
    );
    expect(p032.map((row) => row.opcion)).toEqual([
      'Se incluyen diariamente.',
      'Se incluyen de 2 a 3 veces por semana.',
      'Se incluyen una vez por semana.',
    ]);

    expect(
      rowsForQuestion(questionnaireRows, 'p046').map((row) => row.opcion),
    ).toEqual([
      'Se abordan de forma activa y transversal en el plan de estudios, y se realizan actividades de sensibilización planificadas y regulares.',
      'Se abordan ocasionalmente o sin enfoque sistemático',
      'No se abordan estos temas.',
    ]);
  });

  it('conserva la nueva alternativa sin comedor en la fuente sin convertirla en una respuesta puntuable', () => {
    expect(rowsForQuestion(sourceRows, 'p020').at(-1)).toMatchObject({
      opcion: 'El establecimiento no cuenta con Comedor',
      puntaje: '',
      estado_importacion:
        'Excluida: debe reemplazarse por condición automática',
    });
    expect(
      rowsForQuestion(questionnaireRows, 'p020').some((row) =>
        row.opcion.includes('no cuenta con Comedor'),
      ),
    ).toBe(false);
  });

  it('no duplica opciones visibles dentro de una pregunta', () => {
    const grouped = new Map<string, string[]>();
    for (const row of questionnaireRows) {
      const labels = grouped.get(row.pregunta_codigo) ?? [];
      labels.push(normalize(row.opcion));
      grouped.set(row.pregunta_codigo, labels);
    }

    for (const labels of grouped.values())
      expect(new Set(labels).size).toBe(labels.length);
  });

  it('documenta los 60 estados de mapeo desde la política central y las dos escalas oficiales', () => {
    expect(OFFICIAL_GENERAL_SCORE_PROFILE).toEqual([100, 50, 0]);
    expect(OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE).toEqual([100, 66, 33, 0]);
    expect(scoreMappingRows).toHaveLength(60);
    expect(
      new Set(scoreMappingRows.map((row) => row.pregunta_codigo)).size,
    ).toBe(60);

    const pendingCodes = new Set([
      OFFICIAL_UNRESOLVED_P038_CODE,
      ...OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES,
    ]);
    const actualPendingCodes = new Set(
      scoreMappingRows
        .filter((row) => row.estado === 'Pendiente')
        .map((row) => row.pregunta_codigo),
    );
    expect(actualPendingCodes).toEqual(pendingCodes);
    expect(actualPendingCodes.size).toBe(17);

    for (const mapping of scoreMappingRows) {
      const expected = getApprovedOfficialQuestionScoreSequence(
        mapping.pregunta_codigo,
      );
      const questionRows = rowsForQuestion(
        questionnaireRows,
        mapping.pregunta_codigo,
      );
      const expectedScale =
        mapping.dimension_codigo === 'salud_mental'
          ? OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE.join('/')
          : OFFICIAL_GENERAL_SCORE_PROFILE.join('/');
      expect(mapping.escala_oficial).toBe(expectedScale);

      if (pendingCodes.has(mapping.pregunta_codigo)) {
        expect(expected).toBeNull();
        expect(mapping.mapeo_segun_orden_opciones).toBe('SIN DEFINIR');
        expect(questionRows.every((row) => row.puntaje === '')).toBe(true);
      } else {
        expect(expected).not.toBeNull();
        expect(mapping.estado).toBe('Confirmado');
        expect(mapping.mapeo_segun_orden_opciones).toBe(expected?.join('/'));
        expect(questionRows.map((row) => Number(row.puntaje))).toEqual(
          expected,
        );
      }
    }
  });

  it('conserva únicamente los mapeos cerrados y no asigna puntajes provisorios', () => {
    expect(OFFICIAL_GENERAL_TERNARY_QUESTION_CODES).toHaveLength(39);
    expect(OFFICIAL_GENERAL_BINARY_QUESTION_CODES).toEqual([
      'p022',
      'p023',
      'p025',
    ]);
    expect(
      rowsForQuestion(questionnaireRows, 'p022').map((row) => row.puntaje),
    ).toEqual(['100', '0']);
    expect(
      rowsForQuestion(
        questionnaireRows,
        OFFICIAL_MENTAL_HEALTH_RESOLVED_QUESTION_CODE,
      ).map((row) => Number(row.puntaje)),
    ).toEqual(OFFICIAL_MENTAL_HEALTH_RESOLVED_SCORE_SEQUENCE);

    const pendingSheetText = worksheetText(workbook.getWorksheet('Pendientes'));
    expect(pendingSheetText).toContain(
      'todas sus celdas de puntaje permanecen vacías',
    );
    expect(pendingSheetText.toLowerCase()).not.toContain('provisional');
    expect(pendingSheetText.toLowerCase()).not.toContain('provisori');
  });
});

function rowsForQuestion(rows: WorkbookRow[], code: string) {
  return rows.filter((row) => row.pregunta_codigo === code);
}

function rowsFrom(sheet: ExcelJS.Worksheet | undefined): WorkbookRow[] {
  if (!sheet) throw new Error('No se encontró la hoja esperada.');
  const headers = (sheet.getRow(1).values as unknown[])
    .slice(1)
    .map((value) => String(value));
  const rows: WorkbookRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = Object.fromEntries(
      headers.map((header, index) => [
        header,
        cellValue(row.getCell(index + 1).value),
      ]),
    );
    if (record.pregunta_codigo) rows.push(record);
  });
  return rows;
}

function cellValue(value: ExcelJS.CellValue): string {
  if (value === null) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return String(value);
  return JSON.stringify(value) ?? '';
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function worksheetText(sheet: ExcelJS.Worksheet | undefined) {
  if (!sheet) throw new Error('No se encontró la hoja esperada.');
  const values: string[] = [];
  sheet.eachRow((row) =>
    row.eachCell({ includeEmpty: false }, (cell) =>
      values.push(cellValue(cell.value)),
    ),
  );
  return values.join(' ');
}

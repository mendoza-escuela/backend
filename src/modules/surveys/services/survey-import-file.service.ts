import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';

export type SurveyImportRawRecord = Record<string, string>;
export type SurveyImportTemplateFormat = 'csv' | 'xlsx';

export const SURVEY_IMPORT_HEADERS = [
  'dimension_codigo',
  'seccion_codigo',
  'seccion',
  'pregunta_codigo',
  'pregunta',
  'texto_ayuda',
  'opcion_codigo',
  'opcion',
  'puntaje',
  'obligatoria',
  'orden',
  'condicion',
] as const;

/**
 * Lee y genera archivos del importador sin aplicar reglas funcionales.
 * La interpretación del cuestionario queda en BulkSurveyImportService.
 */
@Injectable()
export class SurveyImportFileService {
  static readonly maxRows = 2_000;

  async template(format: SurveyImportTemplateFormat) {
    if (format === 'csv')
      return {
        buffer: this.csvTemplate(),
        mime: 'text/csv; charset=utf-8',
        extension: 'csv',
      };

    return {
      buffer: await this.xlsxTemplate(),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }

  async read(file: Express.Multer.File): Promise<SurveyImportRawRecord[]> {
    if (!file) throw new BadRequestException('Debés seleccionar un archivo.');
    const extension = file.originalname.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx'].includes(extension ?? ''))
      throw new BadRequestException(
        'El archivo debe tener formato CSV o XLSX.',
      );

    let records: SurveyImportRawRecord[];
    try {
      records =
        extension === 'csv'
          ? this.readCsv(file.buffer)
          : await this.readWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'No se pudo leer el archivo. Verificá que no esté dañado o protegido.',
      );
    }

    if (!records.length)
      throw new BadRequestException(
        'El archivo no contiene filas del cuestionario.',
      );
    if (records.length > SurveyImportFileService.maxRows)
      throw new BadRequestException(
        `El archivo no puede superar ${SurveyImportFileService.maxRows} filas.`,
      );
    return records;
  }

  private csvTemplate() {
    const records = this.exampleRecords();
    const lines = [
      SURVEY_IMPORT_HEADERS.join(','),
      ...records.map((record) =>
        SURVEY_IMPORT_HEADERS.map((header) =>
          this.escapeCsv(record[header] ?? ''),
        ).join(','),
      ),
    ];
    return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
  }

  private async xlsxTemplate() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Escuelas Promotoras de Salud Mendoza';
    const sheet = workbook.addWorksheet('Cuestionario', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.addRow(SURVEY_IMPORT_HEADERS);
    for (const record of this.exampleRecords())
      sheet.addRow(SURVEY_IMPORT_HEADERS.map((header) => record[header] ?? ''));

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000F9F' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;
    sheet.autoFilter = { from: 'A1', to: 'L1' };
    sheet.columns.forEach((column, index) => {
      column.width = [28, 22, 32, 20, 55, 40, 20, 35, 12, 14, 10, 35][index];
    });
    for (let row = 2; row <= SurveyImportFileService.maxRows + 1; row += 1) {
      sheet.getCell(`A${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [
          `"${OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => dimension.code).join(',')}"`,
        ],
      };
      sheet.getCell(`I${row}`).dataValidation = {
        type: 'whole',
        operator: 'between',
        allowBlank: false,
        formulae: [0, 100],
      };
      sheet.getCell(`J${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"si,no"'],
      };
      sheet.getCell(`K${row}`).dataValidation = {
        type: 'whole',
        operator: 'greaterThanOrEqual',
        allowBlank: false,
        formulae: [1],
      };
    }

    const instructions = workbook.addWorksheet('Instrucciones');
    instructions.columns = [
      { key: 'field', width: 30 },
      { key: 'description', width: 100 },
    ];
    instructions.addRow(['Campo', 'Descripción']);
    for (const [field, description] of [
      ['dimension_codigo', 'Código de una de las seis dimensiones oficiales.'],
      ['seccion_codigo', 'Código interno estable de la sección.'],
      [
        'seccion',
        'Título visible de la sección. Se agrega porque el código no reemplaza el texto para el usuario.',
      ],
      [
        'pregunta_codigo',
        'Código único y estable, por ejemplo p001. Repetirlo en cada opción de la misma pregunta.',
      ],
      ['pregunta', 'Texto visible de la pregunta.'],
      ['texto_ayuda', 'Ayuda opcional para comprender la pregunta.'],
      ['opcion_codigo', 'Código estable de la opción.'],
      ['opcion', 'Texto visible de la opción.'],
      ['puntaje', 'Entero entre 0 y 100.'],
      ['obligatoria', 'Usar si o no.'],
      [
        'orden',
        'Orden de la pregunta dentro de la sección. Repetir el mismo valor en todas sus opciones.',
      ],
      [
        'condicion',
        'Reservado. Debe quedar vacío hasta definir el modelo formal de condicionalidad.',
      ],
    ])
      instructions.addRow([field, description]);
    instructions.addRow([]);
    instructions.addRow(['Dimensiones oficiales', '']);
    OFFICIAL_SURVEY_DIMENSIONS.forEach((dimension) =>
      instructions.addRow([
        dimension.code,
        `${dimension.order}. ${dimension.title}`,
      ]),
    );
    instructions.getRow(1).font = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    instructions.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF000F9F' },
    };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private exampleRecords(): SurveyImportRawRecord[] {
    const base = {
      dimension_codigo: OfficialSurveyDimensionCode.InstitutionalCommitment,
      seccion_codigo: 'compromiso',
      seccion: 'Compromiso institucional',
      pregunta_codigo: 'p001',
      pregunta: '¿La institución cuenta con un acta compromiso vigente?',
      texto_ayuda: '',
      obligatoria: 'si',
      orden: '1',
      condicion: '',
    };
    return [
      {
        ...base,
        opcion_codigo: 'optimo',
        opcion: 'Sí',
        puntaje: '100',
      },
      {
        ...base,
        opcion_codigo: 'en_proceso',
        opcion: 'En proceso',
        puntaje: '50',
      },
      {
        ...base,
        opcion_codigo: 'inicial',
        opcion: 'No',
        puntaje: '0',
      },
    ];
  }

  private readCsv(buffer: Buffer): SurveyImportRawRecord[] {
    const lines = buffer
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim());
    if (lines.length < 2) return [];
    const parsedHeaders = this.csvLine(lines[0]).map((value) =>
      this.header(value),
    );
    this.assertHeaders(parsedHeaders);
    return lines.slice(1).map((line) => {
      const values = this.csvLine(line);
      return Object.fromEntries(
        parsedHeaders.map((header, index) => [
          header,
          values[index]?.trim() ?? '',
        ]),
      );
    });
  }

  private async readWorkbook(buffer: Buffer): Promise<SurveyImportRawRecord[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) return [];
    const parsedHeaders = (sheet.getRow(1).values as unknown[])
      .slice(1)
      .map((value) => this.header(this.cell(value)));
    this.assertHeaders(parsedHeaders);
    const rows: SurveyImportRawRecord[] = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const values = (row.values as unknown[]).slice(1);
      if (values.every((value) => !this.cell(value).trim())) return;
      rows.push(
        Object.fromEntries(
          parsedHeaders.map((header, index) => [
            header,
            this.cell(values[index]).trim(),
          ]),
        ),
      );
    });
    return rows;
  }

  private assertHeaders(receivedHeaders: string[]) {
    const missing = SURVEY_IMPORT_HEADERS.filter(
      (requiredHeader) => !receivedHeaders.includes(requiredHeader),
    );
    if (missing.length)
      throw new BadRequestException(
        `Faltan columnas obligatorias: ${missing.join(', ')}.`,
      );
  }

  private header(value: string) {
    return value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '_');
  }

  private csvLine(line: string) {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) {
        values.push(value);
        value = '';
      } else value += char;
    }
    if (quoted)
      throw new BadRequestException('El CSV contiene comillas sin cerrar.');
    values.push(value);
    return values;
  }

  private escapeCsv(value: string) {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  private cell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean')
      return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
      const cell = value as {
        text?: string;
        result?: unknown;
        richText?: Array<{ text?: string }>;
      };
      if (cell.text) return cell.text;
      if (cell.result !== undefined) return this.cell(cell.result);
      if (cell.richText)
        return cell.richText.map((part) => part.text ?? '').join('');
    }
    return '';
  }
}

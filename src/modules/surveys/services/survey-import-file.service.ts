import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { escapeCsvCell } from '../../../common/spreadsheets/spreadsheet-cell.util';
import {
  readCsvImportRecords,
  readXlsxImportRecords,
} from '../../../common/spreadsheets/spreadsheet-import.util';
import {
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';

export type SurveyImportRawRecord = Record<string, string>;
export type SurveyImportTemplateFormat = 'csv' | 'xlsx';

const SURVEY_IMPORT_HEADERS = [
  'dimension',
  'seccion',
  'codigo_pregunta',
  'pregunta',
  'texto_ayuda',
  'opcion',
  'puntaje',
  'obligatoria',
  'orden',
] as const;

const LEGACY_SURVEY_IMPORT_HEADERS = [
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
  static readonly maxRows = Number(process.env.SURVEY_IMPORT_MAX_ROWS ?? 2_000);

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
          escapeCsvCell(record[header] ?? ''),
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
    sheet.autoFilter = { from: 'A1', to: 'I1' };
    sheet.columns.forEach((column, index) => {
      column.width = [32, 32, 20, 55, 40, 35, 12, 14, 10][index];
    });
    for (let row = 2; row <= SurveyImportFileService.maxRows + 1; row += 1) {
      sheet.getCell(`A${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [
          `"${OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => dimension.code).join(',')}"`,
        ],
      };
      sheet.getCell(`G${row}`).dataValidation = {
        type: 'whole',
        operator: 'between',
        allowBlank: false,
        formulae: [0, 100],
      };
      sheet.getCell(`H${row}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"si,no"'],
      };
      sheet.getCell(`I${row}`).dataValidation = {
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
      [
        'dimension',
        'Código o título de una de las seis dimensiones oficiales.',
      ],
      ['seccion', 'Título visible de la sección.'],
      [
        'codigo_pregunta',
        'Código único y estable, por ejemplo p001. Repetirlo en cada opción de la misma pregunta.',
      ],
      ['pregunta', 'Texto visible de la pregunta.'],
      ['texto_ayuda', 'Ayuda opcional para comprender la pregunta.'],
      ['opcion', 'Texto visible de la opción.'],
      ['puntaje', 'Entero entre 0 y 100.'],
      ['obligatoria', 'Usar si o no.'],
      [
        'orden',
        'Orden de la pregunta dentro de la sección. Repetir el mismo valor en todas sus opciones.',
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
      dimension: OfficialSurveyDimensionCode.InstitutionalCommitment,
      seccion: 'Compromiso institucional',
      codigo_pregunta: 'p001',
      pregunta: '¿La institución cuenta con un acta compromiso vigente?',
      texto_ayuda: '',
      obligatoria: 'si',
      orden: '1',
    };
    return [
      {
        ...base,
        opcion: 'Sí',
        puntaje: '100',
      },
      {
        ...base,
        opcion: 'En proceso',
        puntaje: '50',
      },
      {
        ...base,
        opcion: 'No',
        puntaje: '0',
      },
    ];
  }

  private readCsv(buffer: Buffer): SurveyImportRawRecord[] {
    return readCsvImportRecords(buffer, {
      assertHeaders: (headers) => this.assertHeaders(headers),
      unterminatedQuoteMessage: 'El CSV contiene comillas sin cerrar.',
    });
  }

  private async readWorkbook(buffer: Buffer): Promise<SurveyImportRawRecord[]> {
    return readXlsxImportRecords(buffer, {
      assertHeaders: (headers) => this.assertHeaders(headers),
    });
  }

  private assertHeaders(receivedHeaders: string[]) {
    const aliases: Record<string, string[]> = {
      dimension: ['dimension', 'dimension_codigo'],
      codigo_pregunta: ['codigo_pregunta', 'pregunta_codigo'],
    };
    const missing = SURVEY_IMPORT_HEADERS.filter((requiredHeader) => {
      const acceptedNames = aliases[requiredHeader] ?? [requiredHeader];
      return !acceptedNames.some((header) => receivedHeaders.includes(header));
    });
    if (missing.length)
      throw new BadRequestException(
        `Faltan columnas obligatorias: ${missing.join(', ')}.`,
      );
    const unknown = receivedHeaders.filter(
      (header) =>
        !SURVEY_IMPORT_HEADERS.includes(
          header as (typeof SURVEY_IMPORT_HEADERS)[number],
        ) &&
        !LEGACY_SURVEY_IMPORT_HEADERS.includes(
          header as (typeof LEGACY_SURVEY_IMPORT_HEADERS)[number],
        ),
    );
    if (unknown.length)
      throw new BadRequestException(
        `La plantilla contiene columnas desconocidas: ${unknown.join(', ')}.`,
      );
  }
}

import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';

export type SpreadsheetImportRecord = Record<string, string>;

type ImportHeaderValidator = (headers: string[]) => void;

type CsvImportOptions = {
  assertHeaders: ImportHeaderValidator;
  unterminatedQuoteMessage?: string;
};

type XlsxImportOptions = {
  assertHeaders: ImportHeaderValidator;
};

/** Normaliza encabezados de CSV/XLSX sin imponer las columnas de cada dominio. */
export function normalizeImportHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

/**
 * Parsea el CSV completo para conservar comas, comillas y saltos de línea
 * incluidos dentro de campos entrecomillados.
 */
export function parseCsvRows(
  buffer: Buffer,
  unterminatedQuoteMessage = 'El CSV contiene comillas sin cerrar.',
): string[][] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let state: 'unquoted' | 'quoted' | 'after-quote' = 'unquoted';
  let source = '';

  const finishRow = () => {
    row.push(value);
    if (source.trim()) rows.push(row);
    row = [];
    value = '';
    state = 'unquoted';
    source = '';
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (state === 'quoted') {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        source += '""';
        index += 1;
      } else if (character === '"') {
        state = 'after-quote';
        source += character;
      } else {
        value += character;
        source += character;
      }
      continue;
    }

    if (state === 'after-quote') {
      if (character === ',') {
        row.push(value);
        value = '';
        state = 'unquoted';
        source += character;
        continue;
      }
      if (character === '\r' || character === '\n') {
        finishRow();
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        continue;
      }
      throw new BadRequestException(unterminatedQuoteMessage);
    }

    if (character === '"') {
      if (value) throw new BadRequestException(unterminatedQuoteMessage);
      state = 'quoted';
      source += character;
      continue;
    }
    if (character === ',') {
      row.push(value);
      value = '';
      source += character;
      continue;
    }
    if (character === '\r' || character === '\n') {
      finishRow();
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      continue;
    }

    value += character;
    source += character;
  }

  if (state === 'quoted')
    throw new BadRequestException(unterminatedQuoteMessage);
  if (source || row.length || value) finishRow();
  return rows;
}

/** Convierte un CSV en registros conservando la validación propia del dominio. */
export function readCsvImportRecords(
  buffer: Buffer,
  options: CsvImportOptions,
): SpreadsheetImportRecord[] {
  const rows = parseCsvRows(buffer, options.unterminatedQuoteMessage);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeImportHeader);
  options.assertHeaders(headers);
  return rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? '']),
      ),
    );
}

/**
 * Convierte los tipos de celda relevantes de ExcelJS a texto para que todos
 * los importadores interpreten fórmulas, fechas y rich text del mismo modo.
 */
export function xlsxCellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const cell = value as {
      text?: unknown;
      result?: unknown;
      richText?: Array<{ text?: unknown }>;
    };
    if (typeof cell.text === 'string') return cell.text;
    if (cell.result !== undefined) return xlsxCellToString(cell.result);
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => xlsxCellToString(part.text)).join('');
    }
  }
  return '';
}

/** Convierte la primera hoja XLSX en registros con encabezados normalizados. */
export async function readXlsxImportRecords(
  buffer: Buffer,
  options: XlsxImportOptions,
): Promise<SpreadsheetImportRecord[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) return [];

  const headers = (worksheet.getRow(1).values as unknown[])
    .slice(1)
    .map((value) => normalizeImportHeader(xlsxCellToString(value)));
  options.assertHeaders(headers);

  const records: SpreadsheetImportRecord[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as unknown[]).slice(1);
    if (values.every((value) => !xlsxCellToString(value).trim())) return;
    records.push(
      Object.fromEntries(
        headers.map((header, index) => [
          header,
          xlsxCellToString(values[index]).trim(),
        ]),
      ),
    );
  });
  return records;
}

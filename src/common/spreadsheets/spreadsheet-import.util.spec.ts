import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  normalizeImportHeader,
  parseCsvRows,
  readCsvImportRecords,
  readXlsxImportRecords,
  xlsxCellToString,
} from './spreadsheet-import.util';

describe('spreadsheet import utilities', () => {
  it('normalizes whitespace, accents and casing in headers', () => {
    expect(normalizeImportHeader('  Código de Pregunta  ')).toBe(
      'codigo_de_pregunta',
    );
  });

  it('parses escaped quotes, commas and quoted CRLF as one record', () => {
    const rows = parseCsvRows(
      Buffer.from('nombre,detalle\r\n"Escuela ""Uno""","línea 1\r\nlínea 2"'),
    );

    expect(rows).toEqual([
      ['nombre', 'detalle'],
      ['Escuela "Uno"', 'línea 1\r\nlínea 2'],
    ]);
  });

  it('ignores empty physical rows but preserves comma-only records', () => {
    expect(parseCsvRows(Buffer.from('a,b\r\n\r\n  \n,,\r\n1,2\r\n'))).toEqual([
      ['a', 'b'],
      ['', '', ''],
      ['1', '2'],
    ]);
  });

  it('uses the caller-specific unmatched quote message', () => {
    expect(() =>
      readCsvImportRecords(Buffer.from('nombre\r\n"sin cierre'), {
        assertHeaders: jest.fn(),
        unterminatedQuoteMessage: 'Mensaje específico.',
      }),
    ).toThrow(new BadRequestException('Mensaje específico.'));
  });

  it.each([
    'nombre,correo\r\nEscuela "Uno\r\nDos",a@test',
    'nombre,correo\r\n"Escuela" texto,a@test',
  ])('rejects malformed quotes instead of merging records: %s', (csv) => {
    expect(() => parseCsvRows(Buffer.from(csv))).toThrow(
      new BadRequestException('El CSV contiene comillas sin cerrar.'),
    );
  });

  it('maps normalized CSV headers and trims surrounding cell whitespace', () => {
    expect(
      readCsvImportRecords(
        Buffer.from('\uFEFF Nombre Completo ,Correo\r\n Ana Pérez , a@b.test '),
        { assertHeaders: jest.fn() },
      ),
    ).toEqual([{ nombre_completo: 'Ana Pérez', correo: 'a@b.test' }]);
  });

  it('reads XLSX formulas, rich text and dates through one conversion path', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Datos');
    sheet.addRow(['Código', 'Detalle', 'Fecha']);
    sheet.addRow([
      { formula: '1+1', result: 2 },
      { richText: [{ text: 'Escuela ' }, { text: 'Uno' }] },
      new Date('2026-08-31T12:00:00.000Z'),
    ]);
    const records = await readXlsxImportRecords(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      { assertHeaders: jest.fn() },
    );

    expect(records).toEqual([
      {
        codigo: '2',
        detalle: 'Escuela Uno',
        fecha: '2026-08-31T12:00:00.000Z',
      },
    ]);
    expect(xlsxCellToString({ text: 'enlace' })).toBe('enlace');
  });
});

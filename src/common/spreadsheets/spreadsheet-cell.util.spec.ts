import {
  escapeCsvCell,
  spreadsheetSafeCell,
  spreadsheetSafeCsvCell,
} from './spreadsheet-cell.util';

describe('spreadsheetSafeCell', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@IMPORTDATA("url")'])(
    'neutralizes the formula prefix in %s',
    (value) => expect(spreadsheetSafeCell(value)).toBe(`'${value}`),
  );

  it.each([
    '\t=CMD()',
    '\r+SUM(A1:A2)',
    '\n-2+3',
    '  @IMPORTDATA("url")',
    '\uFEFF=HYPERLINK("url")',
    '\u0000+CMD()',
  ])(
    'neutralizes a formula prefix after BOM, whitespace or control characters in %s',
    (value) => expect(spreadsheetSafeCell(value)).toBe(`'${value}`),
  );

  it('keeps ordinary values and serializes structured values safely', () => {
    expect(spreadsheetSafeCell('Escuela 1')).toBe('Escuela 1');
    expect(spreadsheetSafeCell(80)).toBe(80);
    expect(spreadsheetSafeCell(null)).toBe('');
    expect(spreadsheetSafeCell({ code: 'P01' })).toBe('{"code":"P01"}');
  });

  it('escapes quotes and CRLF after neutralizing a dangerous value', () => {
    expect(spreadsheetSafeCsvCell('\uFEFF\t=CMD("x")\r\nlínea 2')).toBe(
      '"\'\uFEFF\t=CMD(""x"")\r\nlínea 2"',
    );
  });

  it('supports explicit always-quoted CSV output', () => {
    expect(escapeCsvCell('Escuela "Uno"', { alwaysQuote: true })).toBe(
      '"Escuela ""Uno"""',
    );
  });
});

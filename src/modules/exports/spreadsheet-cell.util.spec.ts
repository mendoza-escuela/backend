import { spreadsheetSafeCell } from './spreadsheet-cell.util';

describe('spreadsheetSafeCell', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@IMPORTDATA("url")'])(
    'neutralizes the formula prefix in %s',
    (value) => expect(spreadsheetSafeCell(value)).toBe(`'${value}`),
  );

  it('keeps ordinary values and serializes structured values safely', () => {
    expect(spreadsheetSafeCell('Escuela 1')).toBe('Escuela 1');
    expect(spreadsheetSafeCell(80)).toBe(80);
    expect(spreadsheetSafeCell(null)).toBe('');
    expect(spreadsheetSafeCell({ code: 'P01' })).toBe('{"code":"P01"}');
  });
});

type CsvEscapeOptions = {
  alwaysQuote?: boolean;
};

/** Neutraliza valores que Excel y otras planillas interpretarían como fórmula. */
export function spreadsheetSafeCell(value: unknown): string | number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' || typeof value === 'bigint'
        ? String(value)
        : (JSON.stringify(value) ?? '');
  let prefixIndex = 0;
  while (prefixIndex < text.length) {
    const character = text[prefixIndex];
    const code = text.charCodeAt(prefixIndex);
    const isControl = code <= 0x20 || (code >= 0x7f && code <= 0x9f);
    if (!isControl && code !== 0xfeff && character.trim() !== '') break;
    prefixIndex += 1;
  }
  return prefixIndex < text.length && '=+-@'.includes(text[prefixIndex])
    ? `'${text}`
    : text;
}

/** Aplica escaping RFC 4180 sin modificar el contenido de la celda. */
export function escapeCsvCell(
  value: string,
  options: CsvEscapeOptions = {},
): string {
  const mustQuote = options.alwaysQuote || /[",\r\n]/.test(value);
  return mustQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Neutraliza fórmulas antes de aplicar el escaping estructural del CSV. */
export function spreadsheetSafeCsvCell(
  value: unknown,
  options: CsvEscapeOptions = {},
): string {
  return escapeCsvCell(String(spreadsheetSafeCell(value)), options);
}

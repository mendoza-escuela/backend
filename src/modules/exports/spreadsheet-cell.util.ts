/** Neutraliza valores que Excel y otras planillas interpretarían como fórmula. */
export function spreadsheetSafeCell(value: unknown): string | number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' || typeof value === 'bigint'
        ? String(value)
        : (JSON.stringify(value) ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

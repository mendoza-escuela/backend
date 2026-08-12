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

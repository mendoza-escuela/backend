import type { TransformFnParams } from 'class-transformer';

/**
 * Normaliza un filtro multivalor enviado como query repetida.
 *
 * La forma canónica es `?departments=Capital&departments=Lavalle`. Un valor
 * único también se convierte a colección. Los valores no textuales se
 * conservan para que class-validator los rechace.
 */
export function multiValueQuery({ value }: TransformFnParams): unknown {
  const input = value as unknown;
  if (input === undefined || input === null || input === '') return undefined;

  const values: unknown[] = Array.isArray(input)
    ? [...(input as unknown[])]
    : [input];
  const normalized: unknown[] = [];
  const seen = new Set<string>();

  for (const entry of values) {
    if (typeof entry !== 'string') {
      normalized.push(entry);
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.length ? normalized : undefined;
}

/**
 * Normaliza una query repetida sin descartar duplicados. Se usa cuando el DTO
 * debe rechazar explícitamente valores repetidos mediante `ArrayUnique`.
 */
export function multiValueQueryPreservingDuplicates({
  value,
}: TransformFnParams): unknown {
  const input = value as unknown;
  if (input === undefined || input === null || input === '') return undefined;
  const values: unknown[] = Array.isArray(input)
    ? [...(input as unknown[])]
    : [input];
  const normalized = values
    .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
    .filter((entry) => entry !== '');
  return normalized.length ? normalized : undefined;
}

/** Normaliza una query multivalor y convierte cada entrada textual a número. */
export function multiNumberValueQuery(params: TransformFnParams): unknown {
  const normalized = multiValueQuery(params);
  if (!Array.isArray(normalized)) return normalized;
  return (normalized as unknown[]).map((value) =>
    typeof value === 'string' ? Number(value) : value,
  );
}

/** Combina la clave plural canónica con el valor singular legado. */
export function multiValueFilter(
  values: readonly string[] | undefined,
  legacyValue?: string,
): string[] {
  return [
    ...new Set([...(values ?? []), ...(legacyValue ? [legacyValue] : [])]),
  ];
}

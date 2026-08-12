import type { SchoolRectificationSnapshot } from './entities/school-rectification.entity';

export type SchoolRectificationMissingField = {
  code:
    | 'name'
    | 'cue'
    | 'directorName'
    | 'department'
    | 'address'
    | 'locality'
    | 'scope'
    | 'educationLevel'
    | 'shiftCatalog'
    | 'educationLevels'
    | 'hasKiosk'
    | 'hasFoodService';
  label: string;
};

export type SchoolRectificationReadiness = {
  isEvaluationReady: boolean;
  missingFields: SchoolRectificationMissingField[];
};

const REQUIRED_TEXT_FIELDS: ReadonlyArray<{
  code: Extract<
    SchoolRectificationMissingField['code'],
    | 'name'
    | 'cue'
    | 'directorName'
    | 'department'
    | 'address'
    | 'locality'
    | 'scope'
    | 'educationLevel'
  >;
  label: string;
}> = [
  { code: 'name', label: 'Nombre' },
  { code: 'cue', label: 'CUE' },
  { code: 'directorName', label: 'Director/a' },
  { code: 'department', label: 'Departamento' },
  { code: 'address', label: 'Dirección' },
  { code: 'locality', label: 'Localidad' },
  { code: 'scope', label: 'Ámbito' },
  { code: 'educationLevel', label: 'Tipo de educación' },
];

/**
 * Separa la existencia de una confirmación anual de la aptitud de su snapshot
 * para evaluar. Conserva exactamente el gate vigente, incluidos kiosco y
 * comedor, y permite explicar qué datos faltan en confirmaciones históricas.
 */
export function schoolRectificationReadiness(
  snapshot: SchoolRectificationSnapshot | null | undefined,
): SchoolRectificationReadiness {
  if (!snapshot)
    return {
      isEvaluationReady: false,
      missingFields: [],
    };

  const missingFields: SchoolRectificationMissingField[] = [];
  const hasText = (value: unknown) =>
    typeof value === 'string' && value.trim().length >= 2;

  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!hasText(snapshot[field.code])) missingFields.push({ ...field });
  }

  if (
    !snapshot.shiftCatalog?.id ||
    !snapshot.shiftCatalog.code ||
    !snapshot.shiftCatalog.label
  )
    missingFields.push({ code: 'shiftCatalog', label: 'Jornada' });

  if (!snapshot.educationLevels?.length)
    missingFields.push({
      code: 'educationLevels',
      label: 'Niveles educativos',
    });

  if (typeof snapshot.hasKiosk !== 'boolean')
    missingFields.push({ code: 'hasKiosk', label: 'Kiosco' });

  if (typeof snapshot.hasFoodService !== 'boolean')
    missingFields.push({
      code: 'hasFoodService',
      label: 'Comedor o servicio alimentario',
    });

  return {
    isEvaluationReady: missingFields.length === 0,
    missingFields,
  };
}

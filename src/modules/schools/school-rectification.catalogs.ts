export type SchoolRectificationStaticCatalogOption = Readonly<{
  code: string;
  label: string;
}>;

/**
 * Catálogos estáticos de la ficha institucional aprobada.
 *
 * Los códigos son identificadores estables de API. Las columnas heredadas de
 * School conservan las etiquetas visibles para mantener compatibilidad.
 */
export const OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS = {
  managementTypes: [
    { code: 'estatal', label: 'Estatal' },
    { code: 'privado', label: 'Privado' },
  ],
  scopes: [
    { code: 'urbano', label: 'Urbano' },
    { code: 'urbano_marginal', label: 'Urbano Marginal' },
    { code: 'marginal', label: 'Marginal' },
    { code: 'marginal_rural', label: 'Marginal rural' },
    { code: 'rural', label: 'Rural' },
    { code: 'rural_frontera', label: 'Rural de frontera' },
  ],
  educationTypes: [
    { code: 'educacion_comun', label: 'Educación común' },
    {
      code: 'educacion_permanente_jovenes_adultos',
      label: 'Educación permanente de jóvenes y adultos',
    },
    { code: 'educacion_rural', label: 'Educación Rural' },
    { code: 'especial', label: 'Especial' },
    { code: 'domiciliaria', label: 'Domiciliaria' },
    { code: 'hospitalaria', label: 'Hospitalaria' },
  ],
  characteristics: [
    { code: 'isMultigrade', label: 'Plurogrado' },
    {
      code: 'isInterculturalBilingual',
      label: 'Intercultural y Bilingüe',
    },
  ],
} as const satisfies Record<
  string,
  readonly SchoolRectificationStaticCatalogOption[]
>;

export type OfficialSchoolCharacteristics = {
  isMultigrade?: boolean | null;
  isInterculturalBilingual?: boolean | null;
};

export function isOfficialCatalogLabel(
  catalog: 'managementTypes' | 'scopes' | 'educationTypes',
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS[catalog].some(
      ({ label }) => label === value,
    )
  );
}

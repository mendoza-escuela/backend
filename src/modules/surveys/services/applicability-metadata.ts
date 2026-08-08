export type SchoolFeatureType =
  'boolean' | 'string' | 'string_array' | 'number';

export type ApplicabilityFeatureDefinition = {
  key: string;
  label: string;
  type: SchoolFeatureType;
  operators: string[];
  allowedValues?: Array<{ value: string | boolean; label: string }>;
};

export const APPLICABILITY_FEATURES: ApplicabilityFeatureDefinition[] = [
  {
    key: 'has_kiosk',
    label: 'Tiene kiosco',
    type: 'boolean',
    operators: ['equals', 'not_equals'],
    allowedValues: [
      { value: true, label: 'Sí' },
      { value: false, label: 'No' },
    ],
  },
  {
    key: 'has_food_service',
    label: 'Tiene comedor o servicio alimentario',
    type: 'boolean',
    operators: ['equals', 'not_equals'],
    allowedValues: [
      { value: true, label: 'Sí' },
      { value: false, label: 'No' },
    ],
  },
  {
    key: 'is_boarding',
    label: 'Es albergue',
    type: 'boolean',
    operators: ['equals', 'not_equals'],
    allowedValues: [
      { value: true, label: 'Sí' },
      { value: false, label: 'No' },
    ],
  },
  {
    key: 'shift',
    label: 'Jornada',
    type: 'string',
    operators: ['equals', 'not_equals', 'in'],
  },
  {
    key: 'education_levels',
    label: 'Nivel educativo',
    type: 'string_array',
    operators: ['contains', 'not_contains', 'contains_any', 'contains_all'],
  },
  {
    key: 'enrollment_total',
    label: 'Matrícula total',
    type: 'number',
    operators: [
      'equals',
      'not_equals',
      'greater_than',
      'greater_than_or_equal',
      'less_than',
      'less_than_or_equal',
    ],
  },
];

export const APPLICABILITY_OPERATORS = [
  { key: 'equals', label: 'Es igual a' },
  { key: 'not_equals', label: 'Es distinto de' },
  { key: 'in', label: 'Está entre los valores' },
  { key: 'contains', label: 'Contiene' },
  { key: 'not_contains', label: 'No contiene' },
  { key: 'contains_any', label: 'Contiene alguno' },
  { key: 'contains_all', label: 'Contiene todos' },
  { key: 'greater_than', label: 'Es mayor que' },
  { key: 'greater_than_or_equal', label: 'Es mayor o igual que' },
  { key: 'less_than', label: 'Es menor que' },
  { key: 'less_than_or_equal', label: 'Es menor o igual que' },
];

export function getFeatureDefinition(key: string) {
  return APPLICABILITY_FEATURES.find((feature) => feature.key === key);
}

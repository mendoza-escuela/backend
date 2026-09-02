import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import {
  isOfficialSurveyStructure,
  OFFICIAL_SURVEY_QUESTION_CODES,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';

export const OFFICIAL_GENERAL_SCORE_PROFILE = Object.freeze([
  100, 50, 0,
] as const);

export const OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE = Object.freeze([
  100, 66, 33, 0,
] as const);

export const OFFICIAL_GENERAL_BINARY_SCORE_SEQUENCE = Object.freeze([
  100, 0,
] as const);

export const OFFICIAL_P052_SCORE_SEQUENCE = Object.freeze([
  0, 33, 66, 100,
] as const);

export const OFFICIAL_P038_SCORE_SEQUENCE = Object.freeze([
  100, 66, 33, 0,
] as const);

export const OFFICIAL_MENTAL_HEALTH_TERNARY_SCORE_SEQUENCE = Object.freeze([
  100, 50, 0,
] as const);

export const OFFICIAL_GENERAL_TERNARY_QUESTION_CODES = Object.freeze([
  ...questionCodeRange(1, 21),
  'p024',
  ...questionCodeRange(26, 37),
  ...questionCodeRange(39, 40),
  ...questionCodeRange(44, 46),
]);

export const OFFICIAL_GENERAL_BINARY_QUESTION_CODES = Object.freeze([
  'p022',
  'p023',
  'p025',
]);

export const OFFICIAL_P038_QUESTION_CODE = 'p038' as const;

export const OFFICIAL_P052_QUESTION_CODE = 'p052' as const;

export const OFFICIAL_MENTAL_HEALTH_TERNARY_QUESTION_CODES = Object.freeze([
  ...questionCodeRange(41, 43),
  ...questionCodeRange(47, 51),
  ...questionCodeRange(53, 60),
]);

/**
 * Devuelve el perfil de referencia informado para una dimensión oficial.
 *
 * No es una lista exhaustiva de valores permitidos: p038 y las preguntas
 * ternarias de Salud Mental poseen secuencias específicas aprobadas. Para
 * validar opciones debe usarse `getApprovedOfficialQuestionScoreSequence`.
 */
export function getOfficialScoreProfile(
  dimensionCode: string,
): readonly number[] {
  return normalize(dimensionCode) ===
    String(OfficialSurveyDimensionCode.MentalHealth)
    ? OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE
    : OFFICIAL_GENERAL_SCORE_PROFILE;
}

/**
 * Devuelve la secuencia aprobada para el orden actual de opciones de una
 * pregunta oficial. `null` identifica un código fuera de la matriz oficial.
 */
export function getApprovedOfficialQuestionScoreSequence(
  questionCode: string,
): readonly number[] | null {
  const code = normalize(questionCode);
  if (OFFICIAL_GENERAL_TERNARY_QUESTION_CODES.includes(code))
    return OFFICIAL_GENERAL_SCORE_PROFILE;
  if (OFFICIAL_GENERAL_BINARY_QUESTION_CODES.includes(code))
    return OFFICIAL_GENERAL_BINARY_SCORE_SEQUENCE;
  if (code === OFFICIAL_P038_QUESTION_CODE) return OFFICIAL_P038_SCORE_SEQUENCE;
  if (OFFICIAL_MENTAL_HEALTH_TERNARY_QUESTION_CODES.includes(code))
    return OFFICIAL_MENTAL_HEALTH_TERNARY_SCORE_SEQUENCE;
  if (code === OFFICIAL_P052_QUESTION_CODE) return OFFICIAL_P052_SCORE_SEQUENCE;
  return null;
}

/**
 * Valida el mapeo completo de cada pregunta del banco institucional.
 * Cada código se compara con la secuencia aprobada para el orden de sus
 * opciones, de modo que una permutación de los mismos valores también falla.
 */
export function inspectOfficialSurveyScoring(
  dimensions: SurveyDimensionInputDto[],
): string[] {
  if (!isOfficialSurveyStructure(dimensions)) return [];

  const errors: string[] = [];
  for (const dimension of dimensions) {
    for (const section of dimension.sections) {
      for (const question of section.questions) {
        const code = normalize(question.code);
        const scores = question.options.map((option) => option.score ?? null);

        const expected = getApprovedOfficialQuestionScoreSequence(code);
        if (expected && !sameScoreSequence(scores, expected))
          errors.push(
            `${code}: la secuencia de puntajes aprobada según el orden de sus opciones es ${expected.join('/')}; se configuró ${formatScores(scores)}.`,
          );
        else if (!expected && OFFICIAL_SURVEY_QUESTION_CODES.includes(code))
          errors.push(
            `${code}: no tiene un mapeo de puntajes oficial definido.`,
          );
      }
    }
  }

  return errors;
}

function sameScoreSequence(
  actual: Array<number | null>,
  expected: readonly number[],
) {
  return (
    actual.length === expected.length &&
    actual.every((score, index) => score === expected[index])
  );
}

function formatScores(scores: Array<number | null>) {
  return scores.map((score) => score ?? 'sin puntaje').join('/');
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function questionCodeRange(from: number, to: number) {
  return Array.from(
    { length: to - from + 1 },
    (_, index) => `p${String(from + index).padStart(3, '0')}`,
  );
}

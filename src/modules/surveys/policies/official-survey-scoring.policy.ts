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

export const OFFICIAL_MENTAL_HEALTH_RESOLVED_SCORE_SEQUENCE = Object.freeze([
  0, 33, 66, 100,
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

export const OFFICIAL_UNRESOLVED_P038_CODE = 'p038' as const;

export const OFFICIAL_MENTAL_HEALTH_RESOLVED_QUESTION_CODE = 'p052' as const;

export const OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES = Object.freeze([
  ...questionCodeRange(41, 43),
  ...questionCodeRange(47, 51),
  ...questionCodeRange(53, 60),
]);

/**
 * Devuelve los únicos puntajes admitidos por la escala oficial de una
 * dimensión. Sólo debe usarse después de reconocer el banco institucional.
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
 * pregunta oficial. `null` identifica un mapeo todavía no definido.
 */
export function getApprovedOfficialQuestionScoreSequence(
  questionCode: string,
): readonly number[] | null {
  const code = normalize(questionCode);
  if (OFFICIAL_GENERAL_TERNARY_QUESTION_CODES.includes(code))
    return OFFICIAL_GENERAL_SCORE_PROFILE;
  if (OFFICIAL_GENERAL_BINARY_QUESTION_CODES.includes(code))
    return OFFICIAL_GENERAL_BINARY_SCORE_SEQUENCE;
  if (code === OFFICIAL_MENTAL_HEALTH_RESOLVED_QUESTION_CODE)
    return OFFICIAL_MENTAL_HEALTH_RESOLVED_SCORE_SEQUENCE;
  return null;
}

/**
 * Valida el mapeo completo de cada pregunta cuya escala ya está definida.
 * Las dos ambigüedades que las respuestas funcionales no resolvieron se
 * informan como bloqueos de publicación en lugar de inferir puntajes.
 */
export function inspectOfficialSurveyScoring(
  dimensions: SurveyDimensionInputDto[],
): string[] {
  if (!isOfficialSurveyStructure(dimensions)) return [];

  const errors: string[] = [];
  const pendingMentalHealthQuestions: string[] = [];

  for (const dimension of dimensions) {
    for (const section of dimension.sections) {
      for (const question of section.questions) {
        const code = normalize(question.code);
        const scores = question.options.map((option) => option.score ?? null);

        if (code === OFFICIAL_UNRESOLVED_P038_CODE) {
          errors.push(
            'p038: falta definir el puntaje oficial de sus cuatro alternativas; la escala general informada sólo define 100/50/0.',
          );
          continue;
        }

        if (OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES.includes(code)) {
          pendingMentalHealthQuestions.push(code);
          continue;
        }

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

  if (pendingMentalHealthQuestions.length)
    errors.push(
      `Salud Mental: ${pendingMentalHealthQuestions.join(', ')} mantienen puntajes sin definición final; la escala aprobada posee cuatro niveles (100/66/33/0) y falta definir el puntaje exacto de sus tres alternativas, incluida la alternativa intermedia.`,
    );

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

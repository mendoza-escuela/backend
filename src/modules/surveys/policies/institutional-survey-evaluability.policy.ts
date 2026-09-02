import { Injectable } from '@nestjs/common';
import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import {
  getRequiredOfficialDimensionCodeForQuestion,
  isOfficialSurveyStructure,
  OFFICIAL_SURVEY_DIMENSIONS,
  OFFICIAL_SURVEY_QUESTION_CODES,
} from '../templates/official-survey-dimensions.template';
import { inspectOfficialSurveyScoring } from './official-survey-scoring.policy';

export type SurveyEvaluationProfile = 'generic' | 'institutional';

export type InstitutionalSurveyEvaluability = Readonly<{
  profile: SurveyEvaluationProfile;
  evaluable: boolean;
  evaluationErrors: string[];
}>;

export const GENERIC_SURVEY_NOT_EVALUABLE_ERROR =
  'La versión es genérica y no puede utilizarse en campañas institucionales evaluables.';

/**
 * Decide, desde una única política de dominio, si una versión puede alimentar
 * el motor institucional de evaluación.
 *
 * Reconocer cualquier código reservado activa el contrato completo: seis
 * dimensiones, p001-p060 globales, obligatoriedad, selección simple,
 * ubicación oficial y la matriz de puntajes aprobada. Los cuestionarios
 * genéricos continúan siendo publicables, pero nunca son evaluables.
 */
@Injectable()
export class InstitutionalSurveyEvaluabilityPolicy {
  inspect(
    dimensions: SurveyDimensionInputDto[],
  ): InstitutionalSurveyEvaluability {
    if (!isOfficialSurveyStructure(dimensions))
      return {
        profile: 'generic',
        evaluable: false,
        evaluationErrors: [GENERIC_SURVEY_NOT_EVALUABLE_ERROR],
      };

    const evaluationErrors = unique([
      ...this.inspectDimensions(dimensions),
      ...this.inspectQuestions(dimensions),
      ...inspectOfficialSurveyScoring(dimensions),
    ]);

    return {
      profile: 'institutional',
      evaluable: evaluationErrors.length === 0,
      evaluationErrors,
    };
  }

  private inspectDimensions(dimensions: SurveyDimensionInputDto[]): string[] {
    const actualCodes = dimensions.map(({ code }) => normalize(code));
    const expectedCodes = OFFICIAL_SURVEY_DIMENSIONS.map(({ code }) =>
      String(code),
    );
    const expected = new Set(expectedCodes);
    const missing = expectedCodes.filter((code) => !actualCodes.includes(code));
    const unexpected = actualCodes.filter((code) => !expected.has(code));
    const duplicates = duplicated(actualCodes);
    const errors: string[] = [];

    if (
      dimensions.length !== expectedCodes.length ||
      missing.length ||
      unexpected.length ||
      duplicates.length
    )
      errors.push(
        'El cuestionario institucional debe contener exactamente las seis dimensiones oficiales.',
      );
    if (missing.length)
      errors.push(`Faltan dimensiones oficiales: ${missing.join(', ')}.`);
    if (unexpected.length)
      errors.push(
        `El cuestionario institucional contiene dimensiones no oficiales: ${unique(unexpected).join(', ')}.`,
      );
    if (duplicates.length)
      errors.push(
        `El cuestionario institucional contiene dimensiones repetidas: ${duplicates.join(', ')}.`,
      );

    return errors;
  }

  private inspectQuestions(dimensions: SurveyDimensionInputDto[]): string[] {
    const questions = dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) =>
        section.questions.map((question) => ({
          dimensionCode: normalize(dimension.code),
          question,
          questionCode: normalize(question.code),
        })),
      ),
    );
    const actualCodes = questions.map(({ questionCode }) => questionCode);
    const expectedCodes = [...OFFICIAL_SURVEY_QUESTION_CODES];
    const expected = new Set<string>(expectedCodes);
    const missing = expectedCodes.filter((code) => !actualCodes.includes(code));
    const unexpected = actualCodes.filter((code) => !expected.has(code));
    const duplicates = duplicated(actualCodes);
    const optional = questions
      .filter(
        ({ questionCode, question }) =>
          expected.has(questionCode) && !question.required,
      )
      .map(({ questionCode }) => questionCode);
    const unsupportedTypes = questions
      .filter(
        ({ questionCode, question }) =>
          expected.has(questionCode) &&
          question.type !== SurveyQuestionType.SingleChoice,
      )
      .map(({ questionCode }) => questionCode);
    const misplaced = questions
      .map(({ dimensionCode, questionCode }) => ({
        dimensionCode,
        questionCode,
        expectedDimensionCode:
          getRequiredOfficialDimensionCodeForQuestion(questionCode),
      }))
      .filter(
        ({ dimensionCode, expectedDimensionCode }) =>
          expectedDimensionCode !== null &&
          dimensionCode !== String(expectedDimensionCode),
      );
    const errors: string[] = [];

    if (
      questions.length !== expectedCodes.length ||
      missing.length ||
      unexpected.length ||
      duplicates.length
    )
      errors.push(
        'El cuestionario institucional debe contener exactamente las preguntas p001 a p060, sin faltantes, códigos ajenos ni duplicados.',
      );
    if (missing.length)
      errors.push(`Faltan preguntas oficiales: ${missing.join(', ')}.`);
    if (unexpected.length)
      errors.push(
        `El cuestionario institucional contiene preguntas no oficiales: ${unique(unexpected).join(', ')}.`,
      );
    if (duplicates.length)
      errors.push(
        `Hay preguntas oficiales repetidas: ${duplicates.join(', ')}.`,
      );
    if (optional.length)
      errors.push(
        `Las preguntas oficiales deben ser obligatorias: ${unique(optional).join(', ')}.`,
      );
    if (unsupportedTypes.length)
      errors.push(
        `Las preguntas oficiales deben ser de selección simple: ${unique(unsupportedTypes).join(', ')}.`,
      );
    if (misplaced.length)
      errors.push(
        `Las preguntas oficiales deben conservar su dimensión aprobada: ${misplaced
          .map(
            ({ questionCode, dimensionCode, expectedDimensionCode }) =>
              `${questionCode} (${dimensionCode} → ${expectedDimensionCode})`,
          )
          .join(', ')}.`,
      );
    return errors;
  }
}

function duplicated(values: string[]): string[] {
  const occurrences = new Map<string, number>();
  values.forEach((value) =>
    occurrences.set(value, (occurrences.get(value) ?? 0) + 1),
  );
  return [...occurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

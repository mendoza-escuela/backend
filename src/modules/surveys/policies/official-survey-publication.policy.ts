import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import {
  isOfficialSurveyStructure,
  OFFICIAL_SURVEY_DIMENSIONS,
  OFFICIAL_SURVEY_QUESTION_CODES,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';
import { inspectOfficialSurveyScoring } from './official-survey-scoring.policy';

const UNRESOLVED_PUBLICATION_DEFINITIONS = Object.freeze([
  'Comedor/jornada: falta enumerar exactamente las preguntas excluidas y la condición aplicable a cada una.',
  'p041: falta confirmar si “Se trabaja de forma limpia, transversal y sostenida” es la redacción definitiva.',
  'p051: falta confirmar la primera opción, que actualmente refiere a adultos designados aunque la pregunta trata sobre participación familiar.',
  'p059: falta confirmar la redacción “Incluido de forma con implementación específica activa y sostenida”.',
]);

type OfficialQuestion =
  SurveyDimensionInputDto['sections'][number]['questions'][number] & {
    dimensionCode: string;
  };

/**
 * Impide publicar el banco institucional mientras conserve definiciones
 * provisionales o incompletas. Una versión se considera institucional desde
 * que conserva al menos una dimensión o una pregunta oficial; las estructuras
 * completamente personalizadas quedan fuera de esta política.
 */
export function inspectOfficialSurveyPublicationReadiness(
  dimensions: SurveyDimensionInputDto[],
): string[] {
  if (!isOfficialSurveyStructure(dimensions)) return [];

  const errors: string[] = [];
  const expectedDimensionCodes = OFFICIAL_SURVEY_DIMENSIONS.map(
    (dimension) => dimension.code,
  );
  const dimensionCodes = dimensions.map((dimension) =>
    normalize(dimension.code),
  );
  const missingDimensionCodes = expectedDimensionCodes.filter(
    (code) => !dimensionCodes.includes(code),
  );
  const unknownDimensionCodes = [
    ...new Set(
      dimensionCodes.filter(
        (code) =>
          !expectedDimensionCodes.includes(code as OfficialSurveyDimensionCode),
      ),
    ),
  ];
  if (missingDimensionCodes.length)
    errors.push(
      `Faltan dimensiones del banco oficial: ${missingDimensionCodes.join(', ')}.`,
    );
  if (unknownDimensionCodes.length)
    errors.push(
      `El banco oficial contiene dimensiones no reconocidas: ${unknownDimensionCodes.join(', ')}.`,
    );

  const questions = dimensions.flatMap((dimension) =>
    dimension.sections.flatMap((section) =>
      section.questions.map((question) => ({
        ...question,
        dimensionCode: normalize(dimension.code),
      })),
    ),
  );
  const questionsByCode = new Map<string, OfficialQuestion[]>();
  for (const question of questions) {
    const code = normalize(question.code);
    const occurrences = questionsByCode.get(code) ?? [];
    occurrences.push(question);
    questionsByCode.set(code, occurrences);
  }

  if (questions.length !== 60)
    errors.push(
      `El cuestionario institucional debe contener exactamente 60 preguntas y contiene ${questions.length}.`,
    );

  const duplicateCodes = [...questionsByCode]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([code]) => code);
  if (duplicateCodes.length)
    errors.push(
      `Los códigos de pregunta deben ser únicos en todo el cuestionario; están repetidos: ${duplicateCodes.join(', ')}.`,
    );

  const missingCodes = OFFICIAL_SURVEY_QUESTION_CODES.filter(
    (code) => !questionsByCode.has(code),
  );
  const unknownCodes = [...questionsByCode.keys()].filter(
    (code) => !OFFICIAL_SURVEY_QUESTION_CODES.includes(code),
  );
  if (missingCodes.length)
    errors.push(
      `Faltan preguntas del banco oficial: ${missingCodes.join(', ')}.`,
    );
  if (unknownCodes.length)
    errors.push(
      `El banco oficial contiene códigos no reconocidos: ${unknownCodes.join(', ')}.`,
    );

  const optionalCodes = questions
    .filter((question) => !question.required)
    .map((question) => normalize(question.code));
  if (optionalCodes.length)
    errors.push(
      `Todas las preguntas aplicables deben ser obligatorias; revisá: ${optionalCodes.join(', ')}.`,
    );

  const misplacedCodes = questions
    .filter((question) => {
      const number = questionNumber(question.code);
      return (
        number !== null &&
        String(expectedDimension(number)) !== question.dimensionCode
      );
    })
    .map((question) => normalize(question.code));
  if (misplacedCodes.length)
    errors.push(
      `Estas preguntas no pertenecen a la dimensión oficial definida: ${misplacedCodes.join(', ')}.`,
    );

  inspectClosedCorrections(questionsByCode, errors);
  errors.push(...inspectOfficialSurveyScoring(dimensions));
  errors.push(...UNRESOLVED_PUBLICATION_DEFINITIONS);
  return errors;
}

function inspectClosedCorrections(
  questionsByCode: Map<string, OfficialQuestion[]>,
  errors: string[],
) {
  const p010 = singleQuestion(questionsByCode, 'p010');
  if (
    p010 &&
    (p010.prompt.trim() !==
      'Tiempo adecuado para las comidas escolares: Garantía de un tiempo adecuado, asegurando al menos 10 minutos para desayunos y meriendas, y 30 minutos para almuerzos.' ||
      p010.options[0]?.label.trim() !==
        'Se garantiza sistemáticamente 10 minutos para desayuno/merienda y 30 minutos para almuerzo.')
  )
    errors.push(
      'p010 no coincide con el umbral de tiempos aprobado en las respuestas funcionales finales.',
    );

  const p032 = singleQuestion(questionsByCode, 'p032');
  if (
    p032 &&
    (p032.prompt.trim() !==
      'Inclusión diaria de frutas y/o verduras frescas, crudas y preferentemente de estación.' ||
      !sameLabels(p032, [
        'Se incluyen diariamente.',
        'Se incluyen de 2 a 3 veces por semana.',
        'Se incluyen una vez por semana.',
      ]))
  )
    errors.push(
      'p032 no coincide con la pregunta y las tres frecuencias aprobadas en las respuestas funcionales finales.',
    );

  const p046 = singleQuestion(questionsByCode, 'p046');
  if (p046 && p046.options[2]?.label.trim() !== 'No se abordan estos temas.')
    errors.push(
      'p046 debe usar “No se abordan estos temas.” como tercera alternativa.',
    );
}

function sameLabels(question: OfficialQuestion, expected: string[]) {
  return (
    question.options.length === expected.length &&
    question.options.every(
      (option, index) => option.label.trim() === expected[index],
    )
  );
}

function singleQuestion(
  questionsByCode: Map<string, OfficialQuestion[]>,
  code: string,
) {
  const occurrences = questionsByCode.get(code) ?? [];
  return occurrences.length === 1 ? occurrences[0] : null;
}

function expectedDimension(question: number): OfficialSurveyDimensionCode {
  if (question <= 5) return OfficialSurveyDimensionCode.InstitutionalCommitment;
  if (question <= 7) return OfficialSurveyDimensionCode.HealthTeamCoordination;
  if (question <= 34) return OfficialSurveyDimensionCode.HealthyFoodEnvironment;
  if (question <= 40) return OfficialSurveyDimensionCode.PhysicalActivity;
  if (question <= 43) return OfficialSurveyDimensionCode.MentalHealth;
  if (question <= 46) return OfficialSurveyDimensionCode.SmokeFreeSpaces;
  return OfficialSurveyDimensionCode.MentalHealth;
}

function questionNumber(code: string) {
  const match = normalize(code).match(/^p(\d{3})$/);
  return match ? Number(match[1]) : null;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

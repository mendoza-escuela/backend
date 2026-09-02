import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';

export enum OfficialSurveyDimensionCode {
  InstitutionalCommitment = 'compromiso_institucional',
  HealthTeamCoordination = 'articulacion_equipos_salud',
  HealthyFoodEnvironment = 'entorno_alimentario',
  PhysicalActivity = 'actividad_fisica',
  SmokeFreeSpaces = 'espacios_libres_humo',
  MentalHealth = 'salud_mental',
}

export type OfficialSurveyDimensionDefinition = Readonly<{
  code: OfficialSurveyDimensionCode;
  title: string;
  description: string;
  order: number;
}>;

/**
 * Catálogo funcional aprobado para el Programa Escuelas Promotoras de Salud.
 *
 * Los códigos son identificadores internos estables: los textos visibles pueden
 * corregirse en futuras definiciones sin romper resultados históricos.
 */
export const OFFICIAL_SURVEY_DIMENSIONS: readonly OfficialSurveyDimensionDefinition[] =
  Object.freeze([
    Object.freeze({
      code: OfficialSurveyDimensionCode.InstitutionalCommitment,
      title: 'Compromiso Institucional y Planificación Estratégica',
      description:
        'Evalúa la existencia de un acta compromiso vigente, la designación de referentes institucionales y la inclusión de la promoción de la salud en el plan de trabajo anual.',
      order: 1,
    }),
    Object.freeze({
      code: OfficialSurveyDimensionCode.HealthTeamCoordination,
      title: 'Articulación con los Equipos de Salud',
      description:
        'Se centra en los mecanismos formales y circuitos claros de vinculación con centros de salud locales u hospitales para desarrollar actividades conjuntas.',
      order: 2,
    }),
    Object.freeze({
      code: OfficialSurveyDimensionCode.HealthyFoodEnvironment,
      title: 'Entorno Alimentario Seguro y Saludable',
      description:
        'Incluye la educación alimentaria, la higiene, el acceso a agua segura y gratuita, y la regulación de los quioscos y comedores escolares cuando existan.',
      order: 3,
    }),
    Object.freeze({
      code: OfficialSurveyDimensionCode.PhysicalActivity,
      title: 'Actividad Física y Entorno Favorecedor',
      description:
        'Evalúa la disponibilidad de espacios seguros, el cumplimiento de los estímulos de Educación Física y la implementación de recreos activos.',
      order: 4,
    }),
    Object.freeze({
      code: OfficialSurveyDimensionCode.SmokeFreeSpaces,
      title: 'Espacios 100% Libres de Humo de Tabaco',
      description:
        'Analiza la existencia de políticas escritas que prohíban fumar o vapear, la señalización adecuada y las acciones de sensibilización sobre los riesgos del tabaquismo.',
      order: 5,
    }),
    Object.freeze({
      code: OfficialSurveyDimensionCode.MentalHealth,
      title: 'Salud Mental y Bienestar Emocional',
      description:
        'Consolida el abordaje del bienestar emocional de los estudiantes, los espacios de participación, la convivencia y la articulación sistemática con el sistema de salud para el abordaje de la salud mental.',
      order: 6,
    }),
  ]);

/**
 * Las preguntas que la documentación anterior ubicaba bajo “Entorno
 * Socioemocional” forman parte de Salud Mental y Bienestar Emocional.
 */
export const OFFICIAL_SOCIOEMOTIONAL_QUESTION_NUMBERS = Object.freeze([
  41, 42, 43,
] as const);

export const OFFICIAL_SURVEY_QUESTION_CODES = Object.freeze(
  Array.from(
    { length: 60 },
    (_, index) => `p${String(index + 1).padStart(3, '0')}`,
  ),
);

/**
 * Genera una estructura nueva para una versión borrador. No incluye secciones
 * ni preguntas porque el cuestionario definitivo todavía no fue aprobado.
 */
export function createOfficialSurveyDimensionInputs(): SurveyDimensionInputDto[] {
  return OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => ({
    code: dimension.code,
    title: dimension.title,
    description: dimension.description,
    sections: [],
  }));
}

export function getOfficialDimensionCodeForQuestion(
  questionNumber: number,
): OfficialSurveyDimensionCode | null {
  return OFFICIAL_SOCIOEMOTIONAL_QUESTION_NUMBERS.includes(
    questionNumber as 41 | 42 | 43,
  )
    ? OfficialSurveyDimensionCode.MentalHealth
    : null;
}

/**
 * Devuelve la dimensión obligatoria de una pregunta del banco institucional.
 * Fuera del inventario p001-p060 no existe una asignación oficial.
 */
export function getRequiredOfficialDimensionCodeForQuestion(
  questionCode: string,
): OfficialSurveyDimensionCode | null {
  const match = /^p(\d{3})$/i.exec(questionCode.trim());
  if (!match) return null;

  const questionNumber = Number(match[1]);
  if (questionNumber < 1 || questionNumber > 60) return null;
  if (questionNumber <= 5)
    return OfficialSurveyDimensionCode.InstitutionalCommitment;
  if (questionNumber <= 7)
    return OfficialSurveyDimensionCode.HealthTeamCoordination;
  if (questionNumber <= 34)
    return OfficialSurveyDimensionCode.HealthyFoodEnvironment;
  if (questionNumber <= 40) return OfficialSurveyDimensionCode.PhysicalActivity;
  if (questionNumber <= 43) return OfficialSurveyDimensionCode.MentalHealth;
  if (questionNumber <= 46) return OfficialSurveyDimensionCode.SmokeFreeSpaces;
  return OfficialSurveyDimensionCode.MentalHealth;
}

/**
 * Reconoce el instrumento institucional por su espacio de nombres reservado.
 * Los códigos de dimensión oficiales y p001-p060 no deben reutilizarse en
 * cuestionarios personalizados.
 */
export function isOfficialSurveyStructure(
  dimensions: ReadonlyArray<{
    code: string;
    sections?: ReadonlyArray<{
      questions?: ReadonlyArray<{ code: string }>;
    }>;
  }>,
): boolean {
  const officialCodes = new Set<string>(
    OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => dimension.code),
  );
  if (
    dimensions.some((dimension) =>
      officialCodes.has(dimension.code.trim().toLowerCase()),
    )
  )
    return true;

  const officialQuestionCodes = new Set(OFFICIAL_SURVEY_QUESTION_CODES);
  return dimensions.some((dimension) =>
    (dimension.sections ?? []).some((section) =>
      (section.questions ?? []).some((question) =>
        officialQuestionCodes.has(question.code.trim().toLowerCase()),
      ),
    ),
  );
}

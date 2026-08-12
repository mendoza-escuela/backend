import {
  createOfficialSurveyDimensionInputs,
  getOfficialDimensionCodeForQuestion,
  isOfficialSurveyStructure,
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from './official-survey-dimensions.template';

describe('Official survey dimensions template', () => {
  it('define exactamente seis dimensiones oficiales, ordenadas y con códigos únicos', () => {
    expect(OFFICIAL_SURVEY_DIMENSIONS).toHaveLength(6);
    expect(
      OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => dimension.order),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      new Set(OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => dimension.code))
        .size,
    ).toBe(6);
    expect(
      OFFICIAL_SURVEY_DIMENSIONS.some((dimension) =>
        dimension.title.toLowerCase().includes('entorno socioemocional'),
      ),
    ).toBe(false);
  });

  it.each([41, 42, 43])(
    'asigna la pregunta %i a Salud Mental',
    (questionNumber) => {
      expect(getOfficialDimensionCodeForQuestion(questionNumber)).toBe(
        OfficialSurveyDimensionCode.MentalHealth,
      );
    },
  );

  it('no inventa asignaciones para otras preguntas', () => {
    expect(getOfficialDimensionCodeForQuestion(40)).toBeNull();
    expect(getOfficialDimensionCodeForQuestion(44)).toBeNull();
  });

  it('genera copias independientes sin secciones ni preguntas precargadas', () => {
    const first = createOfficialSurveyDimensionInputs();
    const second = createOfficialSurveyDimensionInputs();

    first[0].title = 'Título modificado';
    first[0].sections.push({
      code: 'temporal',
      title: 'Temporal',
      description: null,
      questions: [],
    });

    expect(second[0].title).toBe(
      'Compromiso Institucional y Planificación Estratégica',
    );
    expect(second.every((dimension) => dimension.sections.length === 0)).toBe(
      true,
    );
  });

  it('reconoce el banco por sus preguntas aunque se hayan renombrado todas las dimensiones', () => {
    expect(
      isOfficialSurveyStructure([
        {
          code: 'dimension_renombrada',
          sections: [
            {
              questions: [{ code: 'P001' }],
            },
          ],
        },
      ]),
    ).toBe(true);
    expect(
      isOfficialSurveyStructure([
        {
          code: 'dimension_personalizada',
          sections: [
            {
              questions: [{ code: 'p061' }],
            },
          ],
        },
      ]),
    ).toBe(false);
  });
});

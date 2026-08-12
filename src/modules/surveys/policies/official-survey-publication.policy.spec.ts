import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import {
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';
import { inspectOfficialSurveyPublicationReadiness } from './official-survey-publication.policy';

describe('Política de publicación del cuestionario oficial', () => {
  it('no restringe cuestionarios genéricos o sintéticos', () => {
    expect(
      inspectOfficialSurveyPublicationReadiness([
        {
          code: 'encuesta_custom',
          title: 'Encuesta custom',
          sections: [
            {
              code: 'general',
              title: 'General',
              questions: [
                {
                  code: 'comentario_opcional',
                  type: SurveyQuestionType.ShortText,
                  prompt: 'Comentario',
                  required: false,
                  options: [],
                },
              ],
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('bloquea cualquier pregunta opcional del banco oficial', () => {
    const dimensions = officialQuestionnaire();
    dimensions[0].sections[0].questions[0].required = false;

    expect(inspectOfficialSurveyPublicationReadiness(dimensions)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Todas las preguntas aplicables deben ser obligatorias; revisá: p001',
        ),
      ]),
    );
  });

  it('detecta el banco oficial aunque falte o se renombre una dimensión', () => {
    const withoutMentalHealth = officialQuestionnaire().filter(
      ({ code }) => code !== String(OfficialSurveyDimensionCode.MentalHealth),
    );
    const missingErrors =
      inspectOfficialSurveyPublicationReadiness(withoutMentalHealth);
    expect(missingErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Faltan dimensiones del banco oficial'),
        expect.stringContaining('salud_mental'),
        expect.stringContaining('exactamente 60 preguntas'),
      ]),
    );

    const renamed = officialQuestionnaire();
    renamed.forEach((dimension, index) => {
      dimension.code = `dimension_renombrada_${index + 1}`;
    });
    const renamedErrors = inspectOfficialSurveyPublicationReadiness(renamed);
    expect(renamedErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Faltan dimensiones del banco oficial'),
        expect.stringContaining('compromiso_institucional'),
        expect.stringContaining('dimensiones no reconocidas'),
        expect.stringContaining('dimension_renombrada_1'),
      ]),
    );
  });

  it('bloquea el banco oficial mientras falten los puntajes, textos y condiciones finales', () => {
    const errors = inspectOfficialSurveyPublicationReadiness(
      officialQuestionnaire(),
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('p038'),
        expect.stringContaining('alternativa intermedia'),
        expect.stringContaining('Comedor/jornada'),
        expect.stringContaining('p041'),
        expect.stringContaining('p051'),
        expect.stringContaining('p059'),
      ]),
    );
    expect(errors.some((error) => error.includes('Kiosco'))).toBe(false);
    expect(errors.some((error) => error.includes('nueve preguntas'))).toBe(
      false,
    );
    expect(errors).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('p010 no coincide'),
        expect.stringContaining('p032 no coincide'),
        expect.stringContaining('p046 debe usar'),
      ]),
    );
  });

  it('detecta banco incompleto, pregunta opcional, dimensión incorrecta y textos obsoletos', () => {
    const dimensions = officialQuestionnaire();
    const questions = dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) => section.questions),
    );
    const p010 = questions.find((question) => question.code === 'p010')!;
    const p032 = questions.find((question) => question.code === 'p032')!;
    const p041 = questions.find((question) => question.code === 'p041')!;
    const p046 = questions.find((question) => question.code === 'p046')!;
    p010.options[0].label = 'Se garantizan 20 minutos.';
    p032.required = false;
    p032.prompt = 'Texto anterior';
    p046.options[2].label = p046.options[1].label;

    const mentalHealth = dimensions.find(
      (dimension) =>
        dimension.code === String(OfficialSurveyDimensionCode.MentalHealth),
    )!;
    const mentalSection = mentalHealth.sections[0];
    mentalSection.questions = mentalSection.questions.filter(
      (question) => question !== p041,
    );
    dimensions
      .find(
        (dimension) =>
          dimension.code ===
          String(OfficialSurveyDimensionCode.PhysicalActivity),
      )!
      .sections[0].questions.push(p041);

    const errors = inspectOfficialSurveyPublicationReadiness(dimensions);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('preguntas aplicables deben ser obligatorias'),
        expect.stringContaining('p041'),
        expect.stringContaining('p010 no coincide'),
        expect.stringContaining('p032 no coincide'),
        expect.stringContaining('p046 debe usar'),
      ]),
    );
  });
});

function officialQuestionnaire(): SurveyDimensionInputDto[] {
  const dimensions = OFFICIAL_SURVEY_DIMENSIONS.map((definition) => ({
    code: definition.code,
    title: definition.title,
    description: definition.description,
    sections: [
      {
        code: `seccion_${definition.order}`,
        title: definition.title,
        questions: [],
      },
    ],
  })) as SurveyDimensionInputDto[];

  for (let number = 1; number <= 60; number += 1) {
    const dimension = dimensions.find(
      ({ code }) => code === String(dimensionFor(number)),
    )!;
    const code = `p${String(number).padStart(3, '0')}`;
    const labels =
      number === 32
        ? [
            'Se incluyen diariamente.',
            'Se incluyen de 2 a 3 veces por semana.',
            'Se incluyen una vez por semana.',
          ]
        : [
            'Respuesta óptima',
            'Respuesta intermedia',
            number === 46 ? 'No se abordan estos temas.' : 'Respuesta inicial',
          ];
    dimension.sections[0].questions.push({
      code,
      type: SurveyQuestionType.SingleChoice,
      prompt:
        number === 10
          ? 'Tiempo adecuado para las comidas escolares: Garantía de un tiempo adecuado, asegurando al menos 10 minutos para desayunos y meriendas, y 30 minutos para almuerzos.'
          : number === 32
            ? 'Inclusión diaria de frutas y/o verduras frescas, crudas y preferentemente de estación.'
            : `Pregunta ${number}`,
      required: true,
      options: labels.map((label, index) => ({
        value: `opcion_${index + 1}`,
        label:
          number === 10 && index === 0
            ? 'Se garantiza sistemáticamente 10 minutos para desayuno/merienda y 30 minutos para almuerzo.'
            : label,
        score:
          dimension.code === String(OfficialSurveyDimensionCode.MentalHealth)
            ? [100, 66, 0][index]
            : [100, 50, 0][index],
      })),
    });
  }

  return dimensions;
}

function dimensionFor(number: number): OfficialSurveyDimensionCode {
  if (number <= 5) return OfficialSurveyDimensionCode.InstitutionalCommitment;
  if (number <= 7) return OfficialSurveyDimensionCode.HealthTeamCoordination;
  if (number <= 34) return OfficialSurveyDimensionCode.HealthyFoodEnvironment;
  if (number <= 40) return OfficialSurveyDimensionCode.PhysicalActivity;
  if (number <= 43) return OfficialSurveyDimensionCode.MentalHealth;
  if (number <= 46) return OfficialSurveyDimensionCode.SmokeFreeSpaces;
  return OfficialSurveyDimensionCode.MentalHealth;
}

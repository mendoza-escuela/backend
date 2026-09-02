import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import {
  OFFICIAL_SURVEY_DIMENSIONS,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';
import {
  GENERIC_SURVEY_NOT_EVALUABLE_ERROR,
  InstitutionalSurveyEvaluabilityPolicy,
} from './institutional-survey-evaluability.policy';
import { getApprovedOfficialQuestionScoreSequence } from './official-survey-scoring.policy';

describe('InstitutionalSurveyEvaluabilityPolicy', () => {
  const policy = new InstitutionalSurveyEvaluabilityPolicy();

  it('mantiene publicable pero no evaluable a una estructura genérica', () => {
    expect(
      policy.inspect([
        {
          code: 'dimension_personalizada',
          title: 'Personalizada',
          sections: [],
        },
      ]),
    ).toEqual({
      profile: 'generic',
      evaluable: false,
      evaluationErrors: [GENERIC_SURVEY_NOT_EVALUABLE_ERROR],
    });
  });

  it('informa en conjunto dimensiones, inventario, obligatoriedad, tipo y ubicación inválidos', () => {
    const dimensions = officialDimensions();
    const first = dimensions[0].sections[0].questions[0];
    first.required = false;
    first.type = SurveyQuestionType.MultipleChoice;
    dimensions[0].sections[0].questions.push({ ...first });
    dimensions[0].code = 'dimension_renombrada';

    const result = policy.inspect(dimensions);

    expect(result.profile).toBe('institutional');
    expect(result.evaluable).toBe(false);
    expect(result.evaluationErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('seis dimensiones oficiales'),
        expect.stringContaining('p001 a p060'),
        expect.stringContaining('obligatorias'),
        expect.stringContaining('selección simple'),
        expect.stringContaining('compromiso_institucional'),
      ]),
    );
  });

  it('certifica como evaluable el banco completo con los puntajes aprobados', () => {
    const result = policy.inspect(officialDimensions());

    expect(result.profile).toBe('institutional');
    expect(result.evaluable).toBe(true);
    expect(result.evaluationErrors).toEqual([]);
  });

  it('rechaza una pregunta ubicada fuera de su dimensión oficial', () => {
    const dimensions = officialDimensions();
    const source = dimensions[0].sections[0].questions;
    const [p001] = source.splice(0, 1);
    dimensions[5].sections[0].questions.push(p001);

    const result = policy.inspect(dimensions);

    expect(result.evaluable).toBe(false);
    expect(result.evaluationErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'p001 (salud_mental → compromiso_institucional)',
        ),
      ]),
    );
  });
});

function officialDimensions(): SurveyDimensionInputDto[] {
  const dimensions: SurveyDimensionInputDto[] = OFFICIAL_SURVEY_DIMENSIONS.map(
    (dimension) => ({
      code: dimension.code,
      title: dimension.title,
      sections: [
        {
          code: `seccion_${dimension.order}`,
          title: dimension.title,
          questions: [],
        },
      ],
    }),
  );

  for (let number = 1; number <= 60; number += 1) {
    const code = `p${String(number).padStart(3, '0')}`;
    const dimension = dimensions.find(
      ({ code: dimensionCode }) =>
        dimensionCode === String(dimensionFor(number)),
    )!;
    const scores = getApprovedOfficialQuestionScoreSequence(code);
    if (!scores)
      throw new Error(`No existe una secuencia oficial para ${code}.`);
    dimension.sections[0].questions.push({
      code,
      type: SurveyQuestionType.SingleChoice,
      prompt: `Pregunta ${number}`,
      required: true,
      options: scores.map((score, index) => ({
        value: `opcion_${index + 1}`,
        label: `Opción ${index + 1}`,
        score,
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

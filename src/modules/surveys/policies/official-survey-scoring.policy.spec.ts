import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import {
  OFFICIAL_SURVEY_QUESTION_CODES,
  OfficialSurveyDimensionCode,
} from '../templates/official-survey-dimensions.template';
import {
  getOfficialScoreProfile,
  inspectOfficialSurveyScoring,
  OFFICIAL_GENERAL_BINARY_QUESTION_CODES,
  OFFICIAL_GENERAL_BINARY_SCORE_SEQUENCE,
  OFFICIAL_GENERAL_SCORE_PROFILE,
  OFFICIAL_GENERAL_TERNARY_QUESTION_CODES,
  OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES,
  OFFICIAL_MENTAL_HEALTH_RESOLVED_QUESTION_CODE,
  OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE,
  OFFICIAL_MENTAL_HEALTH_RESOLVED_SCORE_SEQUENCE,
  OFFICIAL_UNRESOLVED_P038_CODE,
} from './official-survey-scoring.policy';

describe('Política de puntajes del cuestionario oficial', () => {
  it('centraliza las dos escalas aprobadas sin permitir mutarlas', () => {
    expect(OFFICIAL_GENERAL_SCORE_PROFILE).toEqual([100, 50, 0]);
    expect(OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE).toEqual([100, 66, 33, 0]);
    expect(OFFICIAL_GENERAL_BINARY_SCORE_SEQUENCE).toEqual([100, 0]);
    expect(OFFICIAL_MENTAL_HEALTH_RESOLVED_SCORE_SEQUENCE).toEqual([
      0, 33, 66, 100,
    ]);
    expect(OFFICIAL_GENERAL_TERNARY_QUESTION_CODES).toHaveLength(39);
    expect(OFFICIAL_GENERAL_BINARY_QUESTION_CODES).toEqual([
      'p022',
      'p023',
      'p025',
    ]);
    expect(OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES).toHaveLength(16);
    const classifiedCodes = [
      ...OFFICIAL_GENERAL_TERNARY_QUESTION_CODES,
      ...OFFICIAL_GENERAL_BINARY_QUESTION_CODES,
      OFFICIAL_UNRESOLVED_P038_CODE,
      OFFICIAL_MENTAL_HEALTH_RESOLVED_QUESTION_CODE,
      ...OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES,
    ];
    expect(classifiedCodes).toHaveLength(60);
    expect(new Set(classifiedCodes).size).toBe(60);
    expect([...classifiedCodes].sort()).toEqual(
      [...OFFICIAL_SURVEY_QUESTION_CODES].sort(),
    );
    expect(Object.isFrozen(OFFICIAL_GENERAL_SCORE_PROFILE)).toBe(true);
    expect(Object.isFrozen(OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE)).toBe(true);
    expect(
      getOfficialScoreProfile(
        OfficialSurveyDimensionCode.InstitutionalCommitment,
      ),
    ).toBe(OFFICIAL_GENERAL_SCORE_PROFILE);
    expect(
      getOfficialScoreProfile(OfficialSurveyDimensionCode.MentalHealth),
    ).toBe(OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE);
  });

  it('acepta los perfiles completos y los extremos aprobados en preguntas binarias', () => {
    const dimensions = [
      dimension(OfficialSurveyDimensionCode.InstitutionalCommitment, [
        question('p001', [100, 50, 0]),
        question('p022', [100, 0]),
      ]),
      dimension(OfficialSurveyDimensionCode.MentalHealth, [
        question('p052', [0, 33, 66, 100]),
      ]),
    ];

    expect(inspectOfficialSurveyScoring(dimensions)).toEqual([]);
  });

  it('rechaza escalas incompletas o valores repetidos en mapeos definidos', () => {
    const errors = inspectOfficialSurveyScoring([
      dimension(OfficialSurveyDimensionCode.InstitutionalCommitment, [
        question('p001', [100, 0]),
        question('p002', [100, 50, 50]),
        question('p022', [100, 50]),
      ]),
      dimension(OfficialSurveyDimensionCode.MentalHealth, [
        question('p052', [100, 66, 0, 0]),
      ]),
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('p001'),
        expect.stringContaining('100/50/0'),
        expect.stringContaining('p002'),
        expect.stringContaining('p022'),
        expect.stringContaining('100/0'),
        expect.stringContaining('p052'),
        expect.stringContaining('0/33/66/100'),
      ]),
    );
  });

  it('mantiene explícitos los dos mapeos que todavía requieren definición', () => {
    const errors = inspectOfficialSurveyScoring([
      dimension(OfficialSurveyDimensionCode.PhysicalActivity, [
        question('p038', [100, 50, 0, 0]),
      ]),
      dimension(OfficialSurveyDimensionCode.MentalHealth, [
        question('p041', [100, 66, 33, 0]),
        question('p047', [100, 33, 0]),
      ]),
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('p038'),
        expect.stringContaining('cuatro alternativas'),
        expect.stringContaining('p041, p047'),
        expect.stringContaining('puntaje exacto'),
      ]),
    );
  });

  it('rechaza una permutación aunque contenga los mismos valores', () => {
    const errors = inspectOfficialSurveyScoring([
      dimension(OfficialSurveyDimensionCode.InstitutionalCommitment, [
        question('p001', [0, 50, 100]),
      ]),
      dimension(OfficialSurveyDimensionCode.MentalHealth, [
        question('p052', [100, 66, 33, 0]),
      ]),
    ]);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('p001'),
        expect.stringContaining('100/50/0'),
        expect.stringContaining('p052'),
        expect.stringContaining('0/33/66/100'),
      ]),
    );
  });

  it('no aplica la política institucional a cuestionarios personalizados', () => {
    expect(
      inspectOfficialSurveyScoring([
        dimension('encuesta_personalizada', [
          question('pregunta_uno', [80, 25]),
        ]),
      ]),
    ).toEqual([]);
  });
});

function dimension(
  code: string,
  questions: SurveyDimensionInputDto['sections'][number]['questions'],
): SurveyDimensionInputDto {
  return {
    code,
    title: code,
    sections: [{ code: `seccion_${code}`, title: code, questions }],
  };
}

function question(
  code: string,
  scores: number[],
): SurveyDimensionInputDto['sections'][number]['questions'][number] {
  return {
    code,
    type: SurveyQuestionType.SingleChoice,
    prompt: code,
    required: true,
    options: scores.map((score, index) => ({
      value: `opcion_${index + 1}`,
      label: `Opción ${index + 1}`,
      score,
    })),
  };
}

import { SurveyQuestionType } from '../entities/survey-question-type.enum';
import { ApplicabilityEngine } from '../services/applicability-engine.service';
import { SurveyEvaluationService } from '../services/survey-evaluation.service';
import {
  createOfficialKioskApplicabilityRule,
  inspectOfficialKioskApplicability,
  OFFICIAL_KIOSK_QUESTION_CODES,
} from './official-survey-applicability.policy';

describe('Aplicabilidad oficial de kiosco', () => {
  const engine = new ApplicabilityEngine();

  it('aplica con kiosco, excluye sin kiosco y bloquea si el dato falta', () => {
    const rule = createOfficialKioskApplicabilityRule();

    expect(engine.evaluate([rule], { has_kiosk: true }).status).toBe(
      'applicable',
    );
    expect(engine.evaluate([rule], { has_kiosk: false }).status).toBe(
      'excluded',
    );
    expect(engine.evaluate([rule], { has_kiosk: null }).status).toBe(
      'incomplete',
    );
  });

  it('acepta las siete preguntas con el comportamiento requerido', () => {
    expect(inspectOfficialKioskApplicability(dimensions(true), engine)).toEqual(
      [],
    );
  });

  it('detecta una versión oficial que deja las preguntas siempre aplicables', () => {
    const errors = inspectOfficialKioskApplicability(dimensions(false), engine);

    expect(errors).toHaveLength(OFFICIAL_KIOSK_QUESTION_CODES.length);
    expect(errors[0]).toContain('aplicar con kiosco');
  });

  it('ajusta numerador y denominador sin puntuar preguntas excluidas', () => {
    const evaluation = new SurveyEvaluationService(engine);
    const kioskRule = createOfficialKioskApplicabilityRule();
    const questions = [
      {
        id: 'base-question',
        code: 'p001',
        dimensionId: 'dimension-id',
        dimensionCode: 'entorno_alimentario',
        required: true,
        options: [{ id: 'base-option', score: 100 }],
        applicabilityRules: [],
      },
      ...OFFICIAL_KIOSK_QUESTION_CODES.map((code) => ({
        id: `${code}-id`,
        code,
        dimensionId: 'dimension-id',
        dimensionCode: 'entorno_alimentario',
        required: true,
        options: [{ id: `${code}-option`, score: 50 }],
        applicabilityRules: [kioskRule],
      })),
    ];
    const answers = questions.map((question) => ({
      questionId: question.id,
      optionId: question.options[0].id,
    }));

    const withKiosk = evaluation.evaluate(
      questions,
      { has_kiosk: true },
      answers,
    );
    const withoutKiosk = evaluation.evaluate(
      questions,
      { has_kiosk: false },
      answers,
    );
    const unknownKiosk = evaluation.evaluate(
      questions,
      { has_kiosk: null },
      answers,
    );

    expect(withKiosk.general).toEqual({
      numerator: 450,
      denominator: 8,
      average: '56.25',
    });
    expect(withoutKiosk.general).toEqual({
      numerator: 100,
      denominator: 1,
      average: '100',
    });
    expect(
      withoutKiosk.questions.filter(({ status }) => status === 'excluded'),
    ).toHaveLength(7);
    expect(unknownKiosk.general).toEqual({
      numerator: 100,
      denominator: 1,
      average: '100',
    });
    expect(
      unknownKiosk.validationErrors.filter(
        ({ reason }) => reason === 'incomplete_school_data',
      ),
    ).toHaveLength(7);
  });
});

function dimensions(withRules: boolean) {
  return [
    {
      code: 'entorno_alimentario',
      sections: [
        {
          questions: OFFICIAL_KIOSK_QUESTION_CODES.map((code) => ({
            code,
            type: SurveyQuestionType.SingleChoice,
            applicabilityRules: withRules
              ? [createOfficialKioskApplicabilityRule()]
              : [],
          })),
        },
      ],
    },
  ];
}

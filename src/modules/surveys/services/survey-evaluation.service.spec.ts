import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../entities/survey-applicability-rule.entity';
import { ApplicabilityEngine } from './applicability-engine.service';
import {
  EvaluationQuestion,
  SurveyEvaluationService,
} from './survey-evaluation.service';

describe('SurveyEvaluationService', () => {
  const service = new SurveyEvaluationService(new ApplicabilityEngine());
  const question = (
    id: string,
    scores: number[],
    dimensionId = 'dimension-1',
  ): EvaluationQuestion => ({
    id,
    code: id,
    dimensionId,
    dimensionCode: dimensionId,
    required: true,
    options: scores.map((score) => ({ id: `${id}-${score}`, score })),
    applicabilityRules: [],
  });

  it('calcula la escala 100/50/0 y el promedio general directo', () => {
    const questions = [
      question('q1', [100, 50, 0]),
      question('q2', [100, 50, 0], 'dimension-2'),
    ];
    const result = service.evaluate(questions, {}, [
      { questionId: 'q1', optionId: 'q1-100' },
      { questionId: 'q2', optionId: 'q2-50' },
    ]);
    expect(result.general).toEqual({
      numerator: 150,
      denominator: 2,
      average: '75',
    });
  });

  it('acepta la escala 100/66/33/0 desde opciones configuradas', () => {
    const result = service.evaluate(
      [question('salud-mental', [100, 66, 33, 0])],
      {},
      [{ questionId: 'salud-mental', optionId: 'salud-mental-66' }],
    );
    expect(result.general.average).toBe('66');
  });

  it('excluye del numerador y del denominador dinámico', () => {
    const excluded = question('excluded', [100, 0]);
    excluded.applicabilityRules = [
      {
        groupOperator: ApplicabilityGroupOperator.All,
        action: ApplicabilityAction.Omit,
        defaultAction: ApplicabilityAction.Show,
        order: 0,
        conditions: [
          {
            feature: 'has_kiosk',
            operator: 'equals',
            expectedValue: false,
            order: 0,
          },
        ],
      },
    ];
    const result = service.evaluate(
      [question('included', [100, 0]), excluded],
      { has_kiosk: false },
      [
        { questionId: 'included', optionId: 'included-100' },
        { questionId: 'excluded', optionId: 'excluded-0' },
      ],
    );
    expect(result.general).toEqual({
      numerator: 100,
      denominator: 1,
      average: '100',
    });
    expect(result.questions[1].exclusionReason).toContain('Coincidió');
  });

  it('devuelve null para una dimensión sin preguntas aplicables', () => {
    const excluded = question('excluded', [100]);
    excluded.applicabilityRules = [
      {
        groupOperator: ApplicabilityGroupOperator.All,
        action: ApplicabilityAction.Omit,
        defaultAction: ApplicabilityAction.Omit,
        order: 0,
        conditions: [
          {
            feature: 'is_boarding',
            operator: 'equals',
            expectedValue: false,
            order: 0,
          },
        ],
      },
    ];
    const result = service.evaluate([excluded], { is_boarding: false }, []);
    expect(result.dimensions[0]).toMatchObject({
      numerator: 0,
      denominator: 0,
      average: null,
    });
  });

  it('reporta ausencia de respuesta obligatoria sin convertirla en cero', () => {
    const result = service.evaluate([question('required', [100, 0])], {}, []);
    expect(result.general.denominator).toBe(1);
    expect(result.questions[0].score).toBeNull();
    expect(result.validationErrors[0].reason).toBe('missing_required_answer');
  });

  it('no devuelve estrellas ni certificación', () => {
    const result = service.evaluate([question('q1', [100])], {}, [
      { questionId: 'q1', optionId: 'q1-100' },
    ]);
    expect(result).not.toHaveProperty('stars');
    expect(result).not.toHaveProperty('certification');
  });
});

import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../entities/survey-applicability-rule.entity';
import { ApplicabilityEngine } from './applicability-engine.service';

describe('ApplicabilityEngine', () => {
  const engine = new ApplicabilityEngine();
  const rule = (
    conditions: Array<{
      feature: string;
      operator: string;
      expectedValue: string | boolean | string[];
    }>,
    groupOperator = ApplicabilityGroupOperator.All,
    action = ApplicabilityAction.Omit,
    order = 0,
  ) => ({
    id: `rule-${order}`,
    groupOperator,
    action,
    defaultAction: ApplicabilityAction.Show,
    order,
    conditions: conditions.map((condition, conditionOrder) => ({
      ...condition,
      order: conditionOrder,
    })),
  });

  it.each([
    ['sin kiosco', 'has_kiosk', false],
    ['sin comedor', 'has_food_service', false],
    ['jornada simple', 'shift', 'Simple'],
    ['albergue', 'is_boarding', true],
    ['no albergue', 'is_boarding', false],
  ])(
    'excluye una pregunta para escuela %s',
    (_name, feature, expectedValue) => {
      expect(
        engine.evaluate(
          [rule([{ feature, operator: 'equals', expectedValue }])],
          { [feature]: expectedValue },
        ).status,
      ).toBe('excluded');
    },
  );

  it('soporta uno y múltiples niveles educativos', () => {
    const rules = [
      rule([
        {
          feature: 'education_levels',
          operator: 'contains',
          expectedValue: 'Secundario',
        },
      ]),
    ];
    expect(
      engine.evaluate(rules, { education_levels: ['Secundario'] }).applicable,
    ).toBe(false);
    expect(
      engine.evaluate(rules, {
        education_levels: ['Primario', 'Secundario'],
      }).applicable,
    ).toBe(false);
  });

  it('combina condiciones AND', () => {
    expect(
      engine.evaluate(
        [
          rule([
            { feature: 'has_kiosk', operator: 'equals', expectedValue: false },
            { feature: 'shift', operator: 'equals', expectedValue: 'Simple' },
          ]),
        ],
        { has_kiosk: false, shift: 'Simple' },
      ).status,
    ).toBe('excluded');
  });

  it('combina condiciones OR', () => {
    expect(
      engine.evaluate(
        [
          rule(
            [
              {
                feature: 'has_kiosk',
                operator: 'equals',
                expectedValue: false,
              },
              { feature: 'shift', operator: 'equals', expectedValue: 'Simple' },
            ],
            ApplicabilityGroupOperator.Any,
          ),
        ],
        { has_kiosk: true, shift: 'Simple' },
      ).status,
    ).toBe('excluded');
  });

  it('resuelve por primera coincidencia ordenada', () => {
    const decision = engine.evaluate(
      [
        rule(
          [{ feature: 'has_kiosk', operator: 'equals', expectedValue: true }],
          ApplicabilityGroupOperator.All,
          ApplicabilityAction.Show,
          1,
        ),
        rule(
          [{ feature: 'has_kiosk', operator: 'equals', expectedValue: true }],
          ApplicabilityGroupOperator.All,
          ApplicabilityAction.Omit,
          0,
        ),
      ],
      { has_kiosk: true },
    );
    expect(decision.matchedRuleId).toBe('rule-0');
    expect(decision.applicable).toBe(false);
  });

  it('informa explícitamente una característica nula', () => {
    const decision = engine.evaluate(
      [
        rule([
          { feature: 'has_kiosk', operator: 'equals', expectedValue: false },
        ]),
      ],
      { has_kiosk: null },
    );
    expect(decision.status).toBe('incomplete');
    expect(decision.missingFeatures).toEqual(['has_kiosk']);
  });
});

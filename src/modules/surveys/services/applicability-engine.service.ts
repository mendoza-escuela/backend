import { Injectable } from '@nestjs/common';
import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../entities/survey-applicability-rule.entity';

export type ApplicabilityConditionInput = {
  id?: string;
  feature: string;
  operator: string;
  expectedValue: string | number | boolean | string[];
  order: number;
};

export type ApplicabilityRuleInput = {
  id?: string;
  groupOperator: ApplicabilityGroupOperator;
  action: ApplicabilityAction;
  defaultAction: ApplicabilityAction;
  order: number;
  conditions: ApplicabilityConditionInput[];
};

export type SchoolApplicabilityFacts = Record<
  string,
  string | number | boolean | string[] | null | undefined
>;

export type ApplicabilityDecision = {
  status: 'applicable' | 'excluded' | 'incomplete';
  applicable: boolean | null;
  action: ApplicabilityAction | null;
  matchedRuleId: string | null;
  explanation: string;
  missingFeatures: string[];
};

type TruthValue = true | false | 'unknown';

/**
 * Evalúa reglas ordenadas con semántica de primera coincidencia.
 *
 * Una regla ALL coincide si todas sus condiciones son verdaderas; una regla
 * ANY, si al menos una lo es. Si ninguna coincide se usa defaultAction. Si
 * algún dato necesario es desconocido y podría alterar el resultado, se
 * devuelve `incomplete` en lugar de asumir false.
 */
@Injectable()
export class ApplicabilityEngine {
  evaluate(
    rulesInput: ApplicabilityRuleInput[],
    facts: SchoolApplicabilityFacts,
  ): ApplicabilityDecision {
    const rules = [...rulesInput].sort(
      (left, right) => left.order - right.order,
    );
    if (!rules.length)
      return this.decision(
        ApplicabilityAction.Show,
        null,
        'La pregunta no tiene reglas y se muestra de forma predeterminada.',
      );

    for (const rule of rules) {
      const missing = new Set<string>();
      const results = [...rule.conditions]
        .sort((left, right) => left.order - right.order)
        .map((condition) => {
          const value = facts[condition.feature];
          if (value === null || value === undefined) {
            missing.add(condition.feature);
            return 'unknown' as const;
          }
          return this.compare(
            value,
            condition.operator,
            condition.expectedValue,
          );
        });
      const matched = this.combine(results, rule.groupOperator);
      if (matched === true)
        return this.decision(
          rule.action,
          rule.id ?? null,
          `Coincidió la regla de prioridad ${rule.order + 1}; acción: ${rule.action === ApplicabilityAction.Show ? 'mostrar' : 'omitir'}.`,
        );
      if (matched === 'unknown')
        return {
          status: 'incomplete',
          applicable: null,
          action: null,
          matchedRuleId: null,
          explanation: `Falta información escolar para evaluar: ${[...missing].join(', ')}.`,
          missingFeatures: [...missing],
        };
    }

    return this.decision(
      rules[0].defaultAction,
      null,
      `Ninguna regla coincidió; se aplicó la acción predeterminada: ${rules[0].defaultAction === ApplicabilityAction.Show ? 'mostrar' : 'omitir'}.`,
    );
  }

  private decision(
    action: ApplicabilityAction,
    matchedRuleId: string | null,
    explanation: string,
  ): ApplicabilityDecision {
    const applicable = action === ApplicabilityAction.Show;
    return {
      status: applicable ? 'applicable' : 'excluded',
      applicable,
      action,
      matchedRuleId,
      explanation,
      missingFeatures: [],
    };
  }

  private combine(
    values: TruthValue[],
    operator: ApplicabilityGroupOperator,
  ): TruthValue {
    if (operator === ApplicabilityGroupOperator.All) {
      if (values.includes(false)) return false;
      return values.includes('unknown') ? 'unknown' : true;
    }
    if (values.includes(true)) return true;
    return values.includes('unknown') ? 'unknown' : false;
  }

  private compare(
    actual: string | number | boolean | string[],
    operator: string,
    expected: string | number | boolean | string[],
  ): boolean {
    const actualArray = Array.isArray(actual) ? actual : [actual];
    const expectedArray = Array.isArray(expected) ? expected : [expected];
    switch (operator) {
      case 'equals':
        return actual === expected;
      case 'not_equals':
        return actual !== expected;
      case 'in':
        return expectedArray.includes(actual as string | number | boolean);
      case 'contains':
        return actualArray.includes(expectedArray[0]);
      case 'not_contains':
        return !actualArray.includes(expectedArray[0]);
      case 'contains_any':
        return expectedArray.some((value) => actualArray.includes(value));
      case 'contains_all':
        return expectedArray.every((value) => actualArray.includes(value));
      case 'greater_than':
        return typeof actual === 'number' && actual > Number(expected);
      case 'greater_than_or_equal':
        return typeof actual === 'number' && actual >= Number(expected);
      case 'less_than':
        return typeof actual === 'number' && actual < Number(expected);
      case 'less_than_or_equal':
        return typeof actual === 'number' && actual <= Number(expected);
      default:
        return false;
    }
  }
}

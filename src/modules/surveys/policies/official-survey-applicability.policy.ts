import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../entities/survey-applicability-rule.entity';
import {
  ApplicabilityEngine,
  ApplicabilityRuleInput,
} from '../services/applicability-engine.service';
import { isOfficialSurveyStructure } from '../templates/official-survey-dimensions.template';

export const OFFICIAL_KIOSK_QUESTION_CODES = Object.freeze([
  'p021',
  'p022',
  'p023',
  'p024',
  'p025',
  'p026',
  'p027',
] as const);

type QuestionWithApplicability = {
  code: string;
  applicabilityRules?: ApplicabilityRuleInput[];
};

type DimensionWithApplicability = {
  code: string;
  sections: Array<{ questions: QuestionWithApplicability[] }>;
};

/**
 * Regla oficial para las preguntas que sólo corresponden a escuelas con
 * kiosco. Un dato escolar desconocido queda incompleto por decisión del motor.
 */
export function createOfficialKioskApplicabilityRule(): ApplicabilityRuleInput {
  return {
    groupOperator: ApplicabilityGroupOperator.All,
    action: ApplicabilityAction.Show,
    defaultAction: ApplicabilityAction.Omit,
    order: 0,
    conditions: [
      {
        feature: 'has_kiosk',
        operator: 'equals',
        expectedValue: true,
        order: 0,
      },
    ],
  };
}

/**
 * Comprueba el comportamiento observable, no una forma única de expresar la
 * regla: con kiosco aplica, sin kiosco se excluye y sin dato debe bloquearse.
 */
export function inspectOfficialKioskApplicability(
  dimensions: DimensionWithApplicability[],
  engine: ApplicabilityEngine,
): string[] {
  if (!isOfficialSurveyStructure(dimensions)) return [];

  const questions = dimensions.flatMap((dimension) =>
    dimension.sections.flatMap((section) => section.questions),
  );
  const errors: string[] = [];

  for (const questionCode of OFFICIAL_KIOSK_QUESTION_CODES) {
    const question = questions.find(
      ({ code }) => code.trim().toLowerCase() === questionCode,
    );
    if (!question) {
      errors.push(
        `La pregunta oficial ${questionCode} debe existir y depender de la existencia de kiosco.`,
      );
      continue;
    }

    const rules = question.applicabilityRules ?? [];
    const withKiosk = engine.evaluate(rules, { has_kiosk: true });
    const withoutKiosk = engine.evaluate(rules, { has_kiosk: false });
    const unknownKiosk = engine.evaluate(rules, { has_kiosk: null });
    if (
      withKiosk.status !== 'applicable' ||
      withoutKiosk.status !== 'excluded' ||
      unknownKiosk.status !== 'incomplete'
    )
      errors.push(
        `La pregunta oficial ${questionCode} debe aplicar con kiosco, excluirse sin kiosco y bloquearse cuando el dato sea desconocido.`,
      );
  }

  return errors;
}

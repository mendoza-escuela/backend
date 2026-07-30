import { Injectable } from '@nestjs/common';
import {
  ApplicabilityEngine,
  ApplicabilityRuleInput,
  SchoolApplicabilityFacts,
} from './applicability-engine.service';

export type EvaluationOption = { id: string; score: number | null };
export type EvaluationQuestion = {
  id: string;
  code: string;
  dimensionId: string;
  dimensionCode: string;
  required: boolean;
  options: EvaluationOption[];
  applicabilityRules: ApplicabilityRuleInput[];
};
export type EvaluationAnswer = { questionId: string; optionId: string };

export type SurveyEvaluationResult = {
  questions: Array<{
    questionId: string;
    code: string;
    status: 'applicable' | 'excluded' | 'incomplete';
    score: number | null;
    exclusionReason: string | null;
    explanation: string;
  }>;
  dimensions: Array<{
    dimensionId: string;
    dimensionCode: string;
    numerator: number;
    denominator: number;
    average: string | null;
  }>;
  general: { numerator: number; denominator: number; average: string | null };
  validationErrors: Array<{
    questionId: string;
    code: string;
    reason:
      | 'missing_required_answer'
      | 'invalid_option'
      | 'incomplete_school_data'
      | 'missing_score';
    message: string;
  }>;
};

/**
 * Servicio puro de cálculo. Todos los datos de versión, escuela y respuestas
 * son recibidos como valores tipados; el servicio no consulta persistencia.
 */
@Injectable()
export class SurveyEvaluationService {
  constructor(private readonly applicability: ApplicabilityEngine) {}

  /**
   * Calcula únicamente preguntas cuya aplicabilidad ya fue resuelta por el
   * flujo de presentación. Al quitar las reglas de la entrada se evita que el
   * cálculo vuelva a decidir con un contexto distinto.
   */
  evaluateApplicable(
    questions: EvaluationQuestion[],
    answers: EvaluationAnswer[],
  ): SurveyEvaluationResult {
    return this.evaluate(
      questions.map((question) => ({
        ...question,
        applicabilityRules: [],
      })),
      {},
      answers,
    );
  }

  evaluate(
    questions: EvaluationQuestion[],
    schoolFacts: SchoolApplicabilityFacts,
    answers: EvaluationAnswer[],
  ): SurveyEvaluationResult {
    const answerMap = new Map(
      answers.map((answer) => [answer.questionId, answer]),
    );
    const validationErrors: SurveyEvaluationResult['validationErrors'] = [];
    const questionResults: SurveyEvaluationResult['questions'] = [];
    const dimensions = new Map<
      string,
      {
        dimensionId: string;
        dimensionCode: string;
        numerator: number;
        denominator: number;
      }
    >();
    let numerator = 0;
    let denominator = 0;

    for (const question of questions) {
      const dimension = dimensions.get(question.dimensionId) ?? {
        dimensionId: question.dimensionId,
        dimensionCode: question.dimensionCode,
        numerator: 0,
        denominator: 0,
      };
      dimensions.set(question.dimensionId, dimension);
      const decision = this.applicability.evaluate(
        question.applicabilityRules,
        schoolFacts,
      );
      if (decision.status === 'incomplete') {
        validationErrors.push({
          questionId: question.id,
          code: question.code,
          reason: 'incomplete_school_data',
          message: decision.explanation,
        });
        questionResults.push({
          questionId: question.id,
          code: question.code,
          status: 'incomplete',
          score: null,
          exclusionReason: null,
          explanation: decision.explanation,
        });
        continue;
      }
      if (!decision.applicable) {
        questionResults.push({
          questionId: question.id,
          code: question.code,
          status: 'excluded',
          score: null,
          exclusionReason: decision.explanation,
          explanation: decision.explanation,
        });
        continue;
      }

      denominator += 1;
      dimension.denominator += 1;
      const answer = answerMap.get(question.id);
      if (!answer) {
        if (question.required)
          validationErrors.push({
            questionId: question.id,
            code: question.code,
            reason: 'missing_required_answer',
            message: `La pregunta ${question.code} es obligatoria y no tiene respuesta.`,
          });
        questionResults.push({
          questionId: question.id,
          code: question.code,
          status: 'applicable',
          score: null,
          exclusionReason: null,
          explanation: decision.explanation,
        });
        continue;
      }
      const option = question.options.find(({ id }) => id === answer.optionId);
      if (!option) {
        validationErrors.push({
          questionId: question.id,
          code: question.code,
          reason: 'invalid_option',
          message: `La opción indicada no pertenece a la pregunta ${question.code}.`,
        });
      } else if (option.score === null) {
        validationErrors.push({
          questionId: question.id,
          code: question.code,
          reason: 'missing_score',
          message: `La opción respondida de ${question.code} no tiene puntaje configurado.`,
        });
      }
      const score = option?.score ?? null;
      if (score !== null) {
        numerator += score;
        dimension.numerator += score;
      }
      questionResults.push({
        questionId: question.id,
        code: question.code,
        status: 'applicable',
        score,
        exclusionReason: null,
        explanation: decision.explanation,
      });
    }

    return {
      questions: questionResults,
      dimensions: [...dimensions.values()].map((dimension) => ({
        ...dimension,
        average: this.decimalAverage(
          dimension.numerator,
          dimension.denominator,
        ),
      })),
      general: {
        numerator,
        denominator,
        average: this.decimalAverage(numerator, denominator),
      },
      validationErrors,
    };
  }

  private decimalAverage(numerator: number, denominator: number) {
    if (!denominator) return null;
    const scale = 8;
    const scaled = BigInt(numerator) * 10n ** BigInt(scale);
    const quotient = scaled / BigInt(denominator);
    const raw = quotient.toString().padStart(scale + 1, '0');
    const integer = raw.slice(0, -scale);
    const fraction = raw.slice(-scale).replace(/0+$/, '');
    return fraction ? `${integer}.${fraction}` : integer;
  }
}

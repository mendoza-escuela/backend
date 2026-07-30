import { ConflictException, Injectable } from '@nestjs/common';
import { SchoolRectificationSnapshot } from '../../schools/entities/school-rectification.entity';
import { SurveyQuestion } from '../entities/survey-question.entity';
import { SurveyVersion } from '../entities/survey-version.entity';
import {
  ApplicabilityEngine,
  SchoolApplicabilityFacts,
} from './applicability-engine.service';
import {
  APPLICABILITY_FEATURES,
  getFeatureDefinition,
} from './applicability-metadata';
import { schoolApplicabilityFactsFromSnapshot } from './school-applicability-facts';

export type QuestionApplicabilityStatus =
  'applicable' | 'excluded' | 'incomplete';

export type QuestionApplicabilityResolution = {
  questionId: string;
  questionCode: string;
  surveyVersionId: string;
  status: QuestionApplicabilityStatus;
  appliedRuleId: string | null;
  reasonCode:
    | 'NO_APPLICABILITY_RULES'
    | 'MATCHED_SHOW_RULE'
    | 'MATCHED_EXCLUSION_RULE'
    | 'DEFAULT_SHOW'
    | 'DEFAULT_EXCLUSION'
    | 'MISSING_SCHOOL_DATA';
  reasonDescription: string;
  missingFeatures: string[];
  relevantSchoolFacts: SchoolApplicabilityFacts;
  evaluatedAt: Date;
};

export type SurveyApplicabilityResult = {
  surveyVersionId: string;
  status: 'ready' | 'incomplete';
  source: 'evaluated' | 'persisted' | 'reconstructed';
  evaluatedAt: Date;
  decisions: QuestionApplicabilityResolution[];
  applicableQuestionIds: Set<string>;
  excludedQuestionIds: Set<string>;
  incompleteQuestionIds: Set<string>;
  missingFields: Array<{ code: string; label: string }>;
};

/**
 * Evalúa todas las preguntas de una versión en memoria. La versión debe llegar
 * con reglas y condiciones precargadas, por lo que este servicio no realiza
 * consultas y evita evaluaciones N+1.
 */
@Injectable()
export class SurveyApplicabilityService {
  constructor(private readonly engine: ApplicabilityEngine) {}

  evaluate(
    version: SurveyVersion,
    snapshot: SchoolRectificationSnapshot | null,
    evaluatedAt = new Date(),
  ): SurveyApplicabilityResult {
    const facts = schoolApplicabilityFactsFromSnapshot(snapshot);
    const decisions = this.questions(version).map((question) =>
      this.evaluateQuestion(version.id, question, facts, evaluatedAt),
    );
    const result = this.result(version.id, decisions, 'evaluated');
    return snapshot
      ? result
      : {
          ...result,
          status: 'incomplete',
          missingFields: [
            {
              code: 'school_profile_snapshot',
              label: 'Ficha escolar rectificada',
            },
            ...result.missingFields,
          ],
        };
  }

  result(
    versionId: string,
    decisions: QuestionApplicabilityResolution[],
    source: SurveyApplicabilityResult['source'],
  ): SurveyApplicabilityResult {
    const applicableQuestionIds = new Set(
      decisions
        .filter(({ status }) => status === 'applicable')
        .map(({ questionId }) => questionId),
    );
    const excludedQuestionIds = new Set(
      decisions
        .filter(({ status }) => status === 'excluded')
        .map(({ questionId }) => questionId),
    );
    const incompleteQuestionIds = new Set(
      decisions
        .filter(({ status }) => status === 'incomplete')
        .map(({ questionId }) => questionId),
    );
    const missingFeatures = new Set(
      decisions.flatMap(({ missingFeatures }) => missingFeatures),
    );
    return {
      surveyVersionId: versionId,
      status: incompleteQuestionIds.size ? 'incomplete' : 'ready',
      source,
      evaluatedAt:
        decisions.reduce<Date | null>(
          (latest, decision) =>
            !latest || decision.evaluatedAt > latest
              ? decision.evaluatedAt
              : latest,
          null,
        ) ?? new Date(),
      decisions,
      applicableQuestionIds,
      excludedQuestionIds,
      incompleteQuestionIds,
      missingFields: [...missingFeatures].map((code) => ({
        code,
        label: getFeatureDefinition(code)?.label ?? code,
      })),
    };
  }

  private evaluateQuestion(
    versionId: string,
    question: SurveyQuestion,
    facts: SchoolApplicabilityFacts,
    evaluatedAt: Date,
  ): QuestionApplicabilityResolution {
    const rules = question.applicabilityRules ?? [];
    this.assertValidRules(question, rules);
    const decision = this.engine.evaluate(rules, facts);
    const relevantFeatures = new Set(
      rules.flatMap((rule) =>
        (rule.conditions ?? []).map((condition) => condition.feature),
      ),
    );
    const relevantSchoolFacts = Object.fromEntries(
      [...relevantFeatures].map((feature) => [feature, facts[feature] ?? null]),
    );
    return {
      questionId: question.id,
      questionCode: question.code,
      surveyVersionId: versionId,
      status: decision.status,
      appliedRuleId: decision.matchedRuleId,
      reasonCode: this.reasonCode(
        rules.length,
        decision.status,
        decision.matchedRuleId,
      ),
      reasonDescription: decision.explanation,
      missingFeatures: decision.missingFeatures,
      relevantSchoolFacts,
      evaluatedAt,
    };
  }

  private reasonCode(
    ruleCount: number,
    status: QuestionApplicabilityStatus,
    matchedRuleId: string | null,
  ): QuestionApplicabilityResolution['reasonCode'] {
    if (status === 'incomplete') return 'MISSING_SCHOOL_DATA';
    if (!ruleCount) return 'NO_APPLICABILITY_RULES';
    if (matchedRuleId)
      return status === 'applicable'
        ? 'MATCHED_SHOW_RULE'
        : 'MATCHED_EXCLUSION_RULE';
    return status === 'applicable' ? 'DEFAULT_SHOW' : 'DEFAULT_EXCLUSION';
  }

  private assertValidRules(
    question: SurveyQuestion,
    rules: SurveyQuestion['applicabilityRules'],
  ) {
    for (const rule of rules) {
      if (!rule.conditions?.length) throw this.invalidRule(question);
      for (const condition of rule.conditions) {
        const feature = getFeatureDefinition(condition.feature);
        if (
          !feature ||
          !feature.operators.includes(condition.operator) ||
          !APPLICABILITY_FEATURES.some(({ key }) => key === condition.feature)
        )
          throw this.invalidRule(question);
      }
    }
  }

  private invalidRule(question: SurveyQuestion) {
    return new ConflictException(
      `No se pudo evaluar la pregunta ${question.code} porque su regla de aplicabilidad es inválida.`,
    );
  }

  private questions(version: SurveyVersion) {
    return version.dimensions.flatMap((dimension) =>
      dimension.sections.flatMap((section) => section.questions),
    );
  }
}

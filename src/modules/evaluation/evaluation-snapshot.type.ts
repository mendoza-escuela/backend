import type { SchoolRectificationSnapshot } from '../schools/entities/school-rectification.entity';
import type { SurveyAnswerValue } from '../submissions/entities/survey-answer.entity';
import type { QuestionApplicabilityResolution } from '../surveys/services/survey-applicability.service';
import type {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../surveys/entities/survey-applicability-rule.entity';
import type { SurveyQuestionType } from '../surveys/entities/survey-question-type.enum';
import type { SurveyQuestionValidation } from '../surveys/entities/survey-question.entity';
import type { EVALUATION_SNAPSHOT_SCHEMA_VERSION } from './evaluation.constants';

export type EvaluationDecimalSnapshot = string;

export type EvaluationOptionSnapshot = {
  id: string;
  value: string;
  label: string;
  helpText: string | null;
  score: number;
  order: number;
};

export type EvaluationRuleSnapshot = {
  id: string;
  order: number;
  groupOperator: ApplicabilityGroupOperator;
  action: ApplicabilityAction;
  defaultAction: ApplicabilityAction;
  conditions: Array<{
    id: string;
    order: number;
    feature: string;
    operator: string;
    expectedValue: string | number | boolean | string[];
  }>;
};

export type EvaluationQuestionSnapshot = {
  id: string;
  code: string;
  type: SurveyQuestionType;
  prompt: string;
  helpText: string | null;
  required: boolean;
  order: number;
  validation: SurveyQuestionValidation;
  options: EvaluationOptionSnapshot[];
  rules: EvaluationRuleSnapshot[];
  applicability: Omit<
    QuestionApplicabilityResolution,
    'evaluatedAt' | 'relevantSchoolFacts'
  > & {
    evaluatedAt: string;
    relevantSchoolFacts: Record<string, unknown>;
  };
  answer: {
    id: string;
    optionId: string | null;
    value: SurveyAnswerValue;
    selectedOption: EvaluationOptionSnapshot | null;
  } | null;
  scoreUsed: EvaluationDecimalSnapshot | null;
};

export type EvaluationDimensionSnapshot = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  order: number;
  result: {
    numerator: EvaluationDecimalSnapshot;
    denominator: number;
    score: EvaluationDecimalSnapshot | null;
    criticality: {
      isCritical: boolean;
      value: EvaluationDecimalSnapshot | null;
      threshold: EvaluationDecimalSnapshot;
      operator: 'less_than';
      ruleVersion: string;
    } | null;
  };
  sections: Array<{
    id: string;
    code: string;
    title: string;
    description: string | null;
    order: number;
    questions: EvaluationQuestionSnapshot[];
  }>;
};

export type EvaluationSnapshot = {
  schemaVersion: typeof EVALUATION_SNAPSHOT_SCHEMA_VERSION;
  algorithm: {
    version: string;
    calculatedAt: string;
  };
  result: {
    generalScore: EvaluationDecimalSnapshot;
    numerator: EvaluationDecimalSnapshot;
    denominator: number;
    stars: {
      value: number | null;
      baseValue?: number | null;
      ruleVersion: string | null;
      blockingReasons: string[];
      configuration?: {
        id: string;
        versionCode: string;
        mentalHealthCriticalThreshold: string;
        mentalHealthMaxStars: number;
        starRanges: Array<{
          stars: number;
          lowerBound: string;
          upperBound: string;
          lowerInclusive: boolean;
          upperInclusive: boolean;
          order: number;
        }>;
      };
      alerts?: Array<Record<string, unknown>>;
    };
  };
  submission: {
    id: string;
    campaignId: string;
    schoolId: string;
    surveyVersionId: string;
    schoolRectificationId: string | null;
    submittedAt: string | null;
    originalRespondent: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
  };
  school: SchoolRectificationSnapshot;
  survey: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    version: {
      id: string;
      number: number;
      title: string;
      instructions: string | null;
      publishedAt: string;
    };
    dimensions: EvaluationDimensionSnapshot[];
  };
};

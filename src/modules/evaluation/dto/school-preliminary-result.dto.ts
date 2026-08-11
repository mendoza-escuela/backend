import type { SurveyAnswerValue } from '../../submissions/entities/survey-answer.entity';

export type PreliminaryResultDimensionDto = {
  id: string | null;
  code: string;
  title: string;
  order: number;
  score: number | null;
  available: boolean;
  isCritical: boolean;
  criticalValue: number | null;
  criticalThreshold: number | null;
};

export type PreliminaryResultQuestionDto = {
  id: string;
  code: string;
  prompt: string;
  order: number;
  dimension: {
    id: string;
    code: string;
    title: string;
    order: number;
  };
  section: {
    id: string;
    code: string;
    title: string;
    order: number;
  };
};

export type PreliminaryResultAnswerDto = PreliminaryResultQuestionDto & {
  answer: {
    optionId: string | null;
    optionLabel: string | null;
    value: SurveyAnswerValue;
    scoreUsed: number | null;
  };
};

export type PreliminaryResultExcludedQuestionDto =
  PreliminaryResultQuestionDto & {
    exclusion: {
      reasonCode: string;
      reason: string;
    };
  };

export type SchoolPreliminaryResultDto = {
  id: string;
  submission: {
    id: string;
    submittedAt: string;
  };
  school: {
    id: string;
    cue: string;
    name: string;
  };
  campaign: {
    id: string;
    name: string;
    type: string;
  };
  survey: {
    id: string;
    code: string;
    name: string;
    version: {
      id: string;
      number: number;
      title: string;
      publishedAt: string;
    };
  };
  result: {
    generalScore: number;
    numerator: number;
    denominator: number;
    stars: {
      available: boolean;
      base: number | null;
      final: number | null;
      wasLimited: boolean;
      maxWhenMentalHealthCritical: number | null;
      configurationVersion: string | null;
      blockingReasons: string[];
    };
    alerts: Array<{
      code: string;
      severity: string;
      dimensionCode: string;
      threshold: number;
      observedValue: number;
      message: string;
      causedBlocking: boolean;
      starsBefore: number;
      starsAfter: number;
    }>;
    dimensions: PreliminaryResultDimensionDto[];
    mentalHealthCritical: {
      isCritical: boolean;
      value: number | null;
      threshold: number | null;
    };
  };
  applicableQuestions: PreliminaryResultQuestionDto[];
  excludedQuestions: PreliminaryResultExcludedQuestionDto[];
  answers: PreliminaryResultAnswerDto[];
  calculation: {
    calculatedAt: string;
    algorithmVersion: string;
    snapshotSchemaVersion: number;
  };
  dataQuality: {
    complete: boolean;
    warnings: string[];
  };
};

export type SchoolPreliminaryResultSummaryDto = {
  id: string;
  submissionId: string;
  campaign: {
    id: string;
    name: string;
    type: string;
  };
  schoolName: string;
  submittedAt: string;
  generalScore: number;
  stars: number | null;
  calculatedAt: string;
};

export type SchoolPreliminaryResultListDto = {
  items: SchoolPreliminaryResultSummaryDto[];
};

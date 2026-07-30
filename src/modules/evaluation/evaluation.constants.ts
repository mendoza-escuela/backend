export const EVALUATION_ALGORITHM_VERSION =
  'question-average-dynamic-denominator-v1';

export const EVALUATION_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export const MENTAL_HEALTH_CRITICAL_THRESHOLD = '33';
export const MENTAL_HEALTH_CRITICAL_RULE_VERSION =
  'mental-health-critical-lt-33-v1';

export const EVALUATION_CALCULATION_SOURCES = [
  'submission_finalization',
  'single_recalculation',
  'system',
] as const;

export type EvaluationCalculationSource =
  (typeof EVALUATION_CALCULATION_SOURCES)[number];

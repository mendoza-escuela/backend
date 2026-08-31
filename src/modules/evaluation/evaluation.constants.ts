export const EVALUATION_ALGORITHM_VERSION =
  'question-average-dynamic-denominator-v1';

export const EVALUATION_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export type EvaluationCalculationSource =
  'submission_finalization' | 'single_recalculation' | 'system';

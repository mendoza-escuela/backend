import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SurveyDimension } from '../../surveys/entities/survey-dimension.entity';
import { EvaluationResult } from './evaluation-result.entity';

@Entity({ name: 'evaluation_dimension_results' })
@Index(
  'UQ_evaluation_dimension_results_result_dimension',
  ['resultId', 'dimensionId'],
  { unique: true },
)
@Index('IDX_evaluation_dimension_results_dimension', ['dimensionId'])
@Index('IDX_evaluation_dimension_results_dimension_score', [
  'dimensionCode',
  'score',
])
@Index('IDX_evaluation_dimension_results_critical', [
  'isCritical',
  'dimensionCode',
])
@Check('CHK_evaluation_dimension_results_order', '"order" >= 0')
@Check(
  'CHK_evaluation_dimension_results_components',
  `"numerator" >= 0 AND "denominator" >= 0 AND "numerator" <= ("denominator" * 100)`,
)
@Check(
  'CHK_evaluation_dimension_results_score',
  `("denominator" = 0 AND "score" IS NULL AND "numerator" = 0) OR ("denominator" > 0 AND "score" >= 0 AND "score" <= 100)`,
)
@Check(
  'CHK_evaluation_dimension_results_criticality',
  `(
    "is_critical" = false
    AND "critical_value" IS NULL
    AND "critical_threshold" IS NULL
    AND "critical_rule_version" IS NULL
  ) OR (
    "is_critical" = false
    AND "critical_value" IS NULL
    AND "critical_threshold" > 0
    AND "critical_threshold" <= 100
    AND BTRIM("critical_rule_version") <> ''
  ) OR (
    "critical_value" >= 0
    AND "critical_value" <= 100
    AND "critical_threshold" > 0
    AND "critical_threshold" <= 100
    AND BTRIM("critical_rule_version") <> ''
    AND (
      ("is_critical" = true AND "critical_value" < "critical_threshold")
      OR
      ("is_critical" = false AND "critical_value" >= "critical_threshold")
    )
  )`,
)
export class EvaluationDimensionResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'result_id', type: 'uuid' })
  resultId: string;

  @ManyToOne(() => EvaluationResult, (result) => result.dimensionResults, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'result_id',
    foreignKeyConstraintName: 'FK_evaluation_dimension_results_result',
  })
  result: EvaluationResult;

  @Column({ name: 'dimension_id', type: 'uuid' })
  dimensionId: string;

  @ManyToOne(() => SurveyDimension, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'dimension_id',
    foreignKeyConstraintName: 'FK_evaluation_dimension_results_dimension',
  })
  dimension: SurveyDimension;

  @Column({ name: 'dimension_code', type: 'varchar', length: 80 })
  dimensionCode: string;

  @Column({ name: 'dimension_title', type: 'varchar', length: 255 })
  dimensionTitle: string;

  @Column({ type: 'integer' })
  order: number;

  @Column({ type: 'numeric', precision: 16, scale: 8 })
  numerator: string;

  @Column({ type: 'integer' })
  denominator: number;

  @Column({ type: 'numeric', precision: 11, scale: 8, nullable: true })
  score: string | null;

  @Column({ name: 'is_critical', type: 'boolean', default: false })
  isCritical: boolean;

  @Column({
    name: 'critical_value',
    type: 'numeric',
    precision: 11,
    scale: 8,
    nullable: true,
  })
  criticalValue: string | null;

  @Column({
    name: 'critical_threshold',
    type: 'numeric',
    precision: 11,
    scale: 8,
    nullable: true,
  })
  criticalThreshold: string | null;

  @Column({
    name: 'critical_rule_version',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  criticalRuleVersion: string | null;
}

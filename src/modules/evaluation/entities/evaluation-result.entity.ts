import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { User } from '../../users/entities/user.entity';
import { EvaluationConfiguration } from '../../evaluation-config/entities/evaluation-configuration.entity';
import type { EvaluationCalculationSource } from '../evaluation.constants';
import type { EvaluationSnapshot } from '../evaluation-snapshot.type';
import { EvaluationDimensionResult } from './evaluation-dimension-result.entity';

@Entity({ name: 'evaluation_results' })
@Index('IDX_evaluation_results_campaign', ['campaignId'])
@Index('IDX_evaluation_results_school', ['schoolId'])
@Index('IDX_evaluation_results_survey_version', ['surveyVersionId'])
@Index('IDX_evaluation_results_calculated_at', ['calculatedAt'])
@Check(
  'CHK_evaluation_results_general_score',
  `"general_score" >= 0 AND "general_score" <= 100`,
)
@Check(
  'CHK_evaluation_results_general_components',
  `"general_numerator" >= 0 AND "general_denominator" > 0 AND "general_numerator" <= ("general_denominator" * 100)`,
)
@Check(
  'CHK_evaluation_results_algorithm_version',
  `BTRIM("algorithm_version") <> ''`,
)
@Check(
  'CHK_evaluation_results_snapshot_schema_version',
  `"snapshot_schema_version" > 0`,
)
@Check(
  'CHK_evaluation_results_snapshot',
  `jsonb_typeof("snapshot") = 'object' AND "snapshot" ?& ARRAY['schemaVersion', 'algorithm', 'result', 'submission', 'school', 'survey']`,
)
@Check(
  'CHK_evaluation_results_stars',
  `"stars" IS NULL OR ("stars" >= 1 AND "stars" <= 5)`,
)
@Check(
  'CHK_evaluation_results_star_rule_version',
  `"star_rule_version" IS NULL OR BTRIM("star_rule_version") <> ''`,
)
@Check(
  'CHK_evaluation_results_star_blocking_reasons',
  `jsonb_typeof("star_blocking_reasons") = 'array'`,
)
export class EvaluationResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId: string;

  @OneToOne(() => SurveySubmission, (submission) => submission.result, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'submission_id',
    foreignKeyConstraintName: 'FK_evaluation_results_submission',
  })
  submission: SurveySubmission;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'campaign_id',
    foreignKeyConstraintName: 'FK_evaluation_results_campaign',
  })
  campaign: Campaign;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'school_id',
    foreignKeyConstraintName: 'FK_evaluation_results_school',
  })
  school: School;

  @Column({ name: 'survey_version_id', type: 'uuid' })
  surveyVersionId: string;

  @ManyToOne(() => SurveyVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'survey_version_id',
    foreignKeyConstraintName: 'FK_evaluation_results_survey_version',
  })
  surveyVersion: SurveyVersion;

  @Column({ name: 'general_score', type: 'numeric', precision: 11, scale: 8 })
  generalScore: string;

  @Column({
    name: 'general_numerator',
    type: 'numeric',
    precision: 16,
    scale: 8,
  })
  generalNumerator: string;

  @Column({ name: 'general_denominator', type: 'integer' })
  generalDenominator: number;

  @Column({ name: 'algorithm_version', type: 'varchar', length: 100 })
  algorithmVersion: string;

  @Column({ name: 'snapshot_schema_version', type: 'integer' })
  snapshotSchemaVersion: number;

  @Column({ type: 'jsonb' })
  snapshot: EvaluationSnapshot;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt: Date;

  @Column({ name: 'calculated_by_user_id', type: 'uuid', nullable: true })
  calculatedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'calculated_by_user_id',
    foreignKeyConstraintName: 'FK_evaluation_results_calculated_by',
  })
  calculatedBy: User | null;

  @Column({ name: 'calculation_source', type: 'varchar', length: 40 })
  calculationSource: EvaluationCalculationSource;

  @Column({ type: 'smallint', nullable: true })
  stars: number | null;

  @Column({ name: 'base_stars', type: 'smallint', nullable: true })
  baseStars: number | null;

  @Column({ name: 'evaluation_configuration_id', type: 'uuid', nullable: true })
  evaluationConfigurationId: string | null;

  @ManyToOne(() => EvaluationConfiguration, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'evaluation_configuration_id',
    foreignKeyConstraintName: 'FK_evaluation_results_configuration',
  })
  evaluationConfiguration: EvaluationConfiguration | null;

  @Column({
    name: 'evaluation_configuration_version',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  evaluationConfigurationVersion: string | null;

  @Column({ name: 'evaluation_rule_snapshot', type: 'jsonb', nullable: true })
  evaluationRuleSnapshot: Record<string, unknown> | null;

  @Column({ name: 'evaluation_alerts', type: 'jsonb', default: [] })
  evaluationAlerts: Array<Record<string, unknown>>;

  @Column({
    name: 'star_rule_version',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  starRuleVersion: string | null;

  @Column({
    name: 'star_blocking_reasons',
    type: 'jsonb',
    default: [],
  })
  starBlockingReasons: string[];

  @OneToMany(
    () => EvaluationDimensionResult,
    (dimensionResult) => dimensionResult.result,
  )
  dimensionResults: EvaluationDimensionResult[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

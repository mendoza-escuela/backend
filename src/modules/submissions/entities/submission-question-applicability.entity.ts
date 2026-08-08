import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SurveyApplicabilityRule } from '../../surveys/entities/survey-applicability-rule.entity';
import { SurveyQuestion } from '../../surveys/entities/survey-question.entity';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import type {
  QuestionApplicabilityResolution,
  QuestionApplicabilityStatus,
} from '../../surveys/services/survey-applicability.service';
import { SurveySubmission } from './survey-submission.entity';

@Entity({ name: 'submission_question_applicability' })
@Index(
  'UQ_submission_question_applicability_submission_question',
  ['submissionId', 'questionId'],
  { unique: true },
)
@Index('IDX_submission_question_applicability_status', [
  'submissionId',
  'status',
])
@Check(
  'CHK_submission_question_applicability_status',
  `"status" IN ('applicable', 'excluded', 'incomplete')`,
)
@Check(
  'CHK_submission_question_applicability_missing_features',
  `jsonb_typeof("missing_features") = 'array'`,
)
@Check(
  'CHK_submission_question_applicability_relevant_facts',
  `jsonb_typeof("relevant_school_facts") = 'object'`,
)
export class SubmissionQuestionApplicability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId: string;

  @ManyToOne(
    () => SurveySubmission,
    (submission) => submission.applicabilityDecisions,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({
    name: 'submission_id',
    foreignKeyConstraintName: 'FK_submission_question_applicability_submission',
  })
  submission: SurveySubmission;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => SurveyQuestion, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'question_id',
    foreignKeyConstraintName: 'FK_submission_question_applicability_question',
  })
  question: SurveyQuestion;

  @Column({ name: 'survey_version_id', type: 'uuid' })
  surveyVersionId: string;

  @ManyToOne(() => SurveyVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'survey_version_id',
    foreignKeyConstraintName: 'FK_submission_question_applicability_version',
  })
  surveyVersion: SurveyVersion;

  @Column({ name: 'applied_rule_id', type: 'uuid', nullable: true })
  appliedRuleId: string | null;

  @ManyToOne(() => SurveyApplicabilityRule, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'applied_rule_id',
    foreignKeyConstraintName: 'FK_submission_question_applicability_rule',
  })
  appliedRule: SurveyApplicabilityRule | null;

  @Column({ type: 'varchar', length: 16 })
  status: QuestionApplicabilityStatus;

  @Column({ name: 'reason_code', type: 'varchar', length: 60 })
  reasonCode: QuestionApplicabilityResolution['reasonCode'];

  @Column({ name: 'reason_description', type: 'text' })
  reasonDescription: string;

  @Column({ name: 'missing_features', type: 'jsonb', default: [] })
  missingFeatures: string[];

  @Column({ name: 'relevant_school_facts', type: 'jsonb', default: {} })
  relevantSchoolFacts: Record<string, unknown>;

  @Column({ name: 'evaluated_at', type: 'timestamptz' })
  evaluatedAt: Date;
}

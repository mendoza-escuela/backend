import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SurveyOption } from '../../surveys/entities/survey-option.entity';
import { SurveyQuestion } from '../../surveys/entities/survey-question.entity';
import { SurveySubmission } from './survey-submission.entity';

export type SurveyAnswerValue = string | number | boolean | null;

@Entity({ name: 'survey_answers' })
@Index(
  'UQ_survey_answers_submission_question',
  ['submissionId', 'questionId'],
  {
    unique: true,
  },
)
export class SurveyAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId: string;

  @ManyToOne(() => SurveySubmission, (submission) => submission.answers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'submission_id',
    foreignKeyConstraintName: 'FK_survey_answers_submission',
  })
  submission: SurveySubmission;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => SurveyQuestion, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'question_id',
    foreignKeyConstraintName: 'FK_survey_answers_question',
  })
  question: SurveyQuestion;

  @Column({ name: 'option_id', type: 'uuid', nullable: true })
  optionId: string | null;

  @ManyToOne(() => SurveyOption, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'option_id',
    foreignKeyConstraintName: 'FK_survey_answers_option',
  })
  option: SurveyOption | null;

  @Column({ name: 'answer_value', type: 'jsonb', nullable: true })
  value: SurveyAnswerValue;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

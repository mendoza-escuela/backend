import {
  Column,
  Check,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SurveyQuestion } from './survey-question.entity';

@Entity({ name: 'survey_options' })
@Index('UQ_survey_options_question_value', ['questionId', 'value'], {
  unique: true,
})
@Index('UQ_survey_options_question_order', ['questionId', 'order'], {
  unique: true,
})
@Check('CHK_survey_options_order', '"order" >= 0')
export class SurveyOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => SurveyQuestion, (question) => question.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'question_id',
    foreignKeyConstraintName: 'FK_survey_options_question',
  })
  question: SurveyQuestion;

  @Column({ type: 'varchar', length: 120 })
  value: string;

  @Column({ type: 'varchar', length: 500 })
  label: string;

  @Column({ name: 'help_text', type: 'text', nullable: true })
  helpText: string | null;

  @Column({ type: 'integer' })
  order: number;
}

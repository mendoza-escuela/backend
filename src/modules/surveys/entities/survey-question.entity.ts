import {
  Column,
  Check,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SurveyOption } from './survey-option.entity';
import { SurveyQuestionType } from './survey-question-type.enum';
import { SurveySection } from './survey-section.entity';
import { SurveyApplicabilityRule } from './survey-applicability-rule.entity';

export type SurveyQuestionValidation = {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  maxSelections?: number;
  placeholder?: string;
};

@Entity({ name: 'survey_questions' })
@Index('UQ_survey_questions_section_code', ['sectionId', 'code'], {
  unique: true,
})
@Index('UQ_survey_questions_section_order', ['sectionId', 'order'], {
  unique: true,
})
@Check('CHK_survey_questions_order', '"order" >= 0')
@Check(
  'CHK_survey_questions_validation_object',
  `jsonb_typeof("validation") = 'object'`,
)
export class SurveyQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'section_id', type: 'uuid' })
  sectionId: string;

  @ManyToOne(() => SurveySection, (section) => section.questions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'section_id',
    foreignKeyConstraintName: 'FK_survey_questions_section',
  })
  section: SurveySection;

  @Column({ type: 'varchar', length: 80 })
  code: string;

  @Column({
    type: 'enum',
    enum: SurveyQuestionType,
  })
  type: SurveyQuestionType;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ name: 'help_text', type: 'text', nullable: true })
  helpText: string | null;

  @Column({ type: 'boolean', default: false })
  required: boolean;

  @Column({ type: 'integer' })
  order: number;

  @Column({ type: 'jsonb', default: {} })
  validation: SurveyQuestionValidation;

  @OneToMany(() => SurveyOption, (option) => option.question)
  options: SurveyOption[];

  @OneToMany(() => SurveyApplicabilityRule, (rule) => rule.question)
  applicabilityRules: SurveyApplicabilityRule[];
}

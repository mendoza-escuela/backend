import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SurveyApplicabilityCondition } from './survey-applicability-condition.entity';
import { SurveyQuestion } from './survey-question.entity';

export enum ApplicabilityGroupOperator {
  All = 'all',
  Any = 'any',
}

export enum ApplicabilityAction {
  Show = 'show',
  Omit = 'omit',
}

@Entity({ name: 'survey_applicability_rules' })
@Index('UQ_applicability_rules_question_order', ['questionId', 'order'], {
  unique: true,
})
@Check('CHK_applicability_rules_order', '"order" >= 0')
@Check('CHK_applicability_rules_group', `"group_operator" IN ('all', 'any')`)
@Check('CHK_applicability_rules_action', `"action" IN ('show', 'omit')`)
@Check(
  'CHK_applicability_rules_default_action',
  `"default_action" IN ('show', 'omit')`,
)
export class SurveyApplicabilityRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => SurveyQuestion, (question) => question.applicabilityRules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'question_id',
    foreignKeyConstraintName: 'FK_applicability_rules_question',
  })
  question: SurveyQuestion;

  @Column({ name: 'group_operator', type: 'varchar', length: 8 })
  groupOperator: ApplicabilityGroupOperator;

  @Column({ type: 'varchar', length: 8 })
  action: ApplicabilityAction;

  @Column({ name: 'default_action', type: 'varchar', length: 8 })
  defaultAction: ApplicabilityAction;

  @Column({ type: 'integer' })
  order: number;

  @OneToMany(() => SurveyApplicabilityCondition, (condition) => condition.rule)
  conditions: SurveyApplicabilityCondition[];
}

import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SurveyApplicabilityRule } from './survey-applicability-rule.entity';

@Entity({ name: 'survey_applicability_conditions' })
@Index('UQ_applicability_conditions_rule_order', ['ruleId', 'order'], {
  unique: true,
})
@Check('CHK_applicability_conditions_order', '"order" >= 0')
export class SurveyApplicabilityCondition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId: string;

  @ManyToOne(() => SurveyApplicabilityRule, (rule) => rule.conditions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'rule_id',
    foreignKeyConstraintName: 'FK_applicability_conditions_rule',
  })
  rule: SurveyApplicabilityRule;

  @Column({ type: 'varchar', length: 40 })
  feature: string;

  @Column({ type: 'varchar', length: 24 })
  operator: string;

  @Column({ name: 'expected_value', type: 'jsonb' })
  expectedValue: string | number | boolean | string[];

  @Column({ type: 'integer' })
  order: number;
}

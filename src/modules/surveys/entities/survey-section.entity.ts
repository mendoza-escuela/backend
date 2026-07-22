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
import { SurveyDimension } from './survey-dimension.entity';
import { SurveyQuestion } from './survey-question.entity';

@Entity({ name: 'survey_sections' })
@Index('UQ_survey_sections_dimension_code', ['dimensionId', 'code'], {
  unique: true,
})
@Index('UQ_survey_sections_dimension_order', ['dimensionId', 'order'], {
  unique: true,
})
@Check('CHK_survey_sections_order', '"order" >= 0')
export class SurveySection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dimension_id', type: 'uuid' })
  dimensionId: string;

  @ManyToOne(() => SurveyDimension, (dimension) => dimension.sections, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'dimension_id',
    foreignKeyConstraintName: 'FK_survey_sections_dimension',
  })
  dimension: SurveyDimension;

  @Column({ type: 'varchar', length: 80 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'integer' })
  order: number;

  @OneToMany(() => SurveyQuestion, (question) => question.section)
  questions: SurveyQuestion[];
}

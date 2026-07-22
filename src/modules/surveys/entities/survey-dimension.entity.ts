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
import { SurveySection } from './survey-section.entity';
import { SurveyVersion } from './survey-version.entity';

@Entity({ name: 'survey_dimensions' })
@Index('UQ_survey_dimensions_version_code', ['versionId', 'code'], {
  unique: true,
})
@Index('UQ_survey_dimensions_version_order', ['versionId', 'order'], {
  unique: true,
})
@Check('CHK_survey_dimensions_order', '"order" >= 0')
export class SurveyDimension {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'version_id', type: 'uuid' })
  versionId: string;

  @ManyToOne(() => SurveyVersion, (version) => version.dimensions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'version_id',
    foreignKeyConstraintName: 'FK_survey_dimensions_version',
  })
  version: SurveyVersion;

  @Column({ type: 'varchar', length: 80 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'integer' })
  order: number;

  @OneToMany(() => SurveySection, (section) => section.dimension)
  sections: SurveySection[];
}

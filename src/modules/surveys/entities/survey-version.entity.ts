import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SurveyDimension } from './survey-dimension.entity';
import { Survey } from './survey.entity';
import { SurveyVersionStatus } from './survey-version-status.enum';

@Entity({ name: 'survey_versions' })
@Index('UQ_survey_versions_survey_number', ['surveyId', 'versionNumber'], {
  unique: true,
})
@Index('UQ_survey_versions_single_published', ['surveyId'], {
  unique: true,
  where: `"status" = 'published'`,
})
@Check('CHK_survey_versions_positive_number', '"version_number" > 0')
@Check(
  'CHK_survey_versions_published_at',
  `("status" = 'published' AND "published_at" IS NOT NULL) OR "status" <> 'published'`,
)
export class SurveyVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'survey_id', type: 'uuid' })
  surveyId: string;

  @ManyToOne(() => Survey, (survey) => survey.versions, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'survey_id',
    foreignKeyConstraintName: 'FK_survey_versions_survey',
  })
  survey: Survey;

  @Column({ name: 'version_number', type: 'integer' })
  versionNumber: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  instructions: string | null;

  @Index('IDX_survey_versions_status')
  @Column({
    type: 'enum',
    enum: SurveyVersionStatus,
    default: SurveyVersionStatus.Draft,
  })
  status: SurveyVersionStatus;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @OneToMany(() => SurveyDimension, (dimension) => dimension.version)
  dimensions: SurveyDimension[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

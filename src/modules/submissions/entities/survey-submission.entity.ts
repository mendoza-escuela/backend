import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { User } from '../../users/entities/user.entity';
import { SubmissionStatus } from './submission-status.enum';
import { SurveyAnswer } from './survey-answer.entity';

export type RespondentSnapshot = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

@Entity({ name: 'survey_submissions' })
@Index('UQ_survey_submissions_school_campaign', ['schoolId', 'campaignId'], {
  unique: true,
})
@Index('IDX_survey_submissions_campaign_status', ['campaignId', 'status'])
@Check(
  'CHK_survey_submissions_respondent_snapshot',
  `jsonb_typeof("original_respondent_snapshot") = 'object'`,
)
@Check(
  'CHK_survey_submissions_submitted_at',
  `("status" = 'submitted' AND "submitted_at" IS NOT NULL) OR ("status" = 'draft' AND "submitted_at" IS NULL)`,
)
export class SurveySubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'campaign_id',
    foreignKeyConstraintName: 'FK_survey_submissions_campaign',
  })
  campaign: Campaign;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'school_id',
    foreignKeyConstraintName: 'FK_survey_submissions_school',
  })
  school: School;

  @Column({ name: 'survey_version_id', type: 'uuid' })
  surveyVersionId: string;

  @ManyToOne(() => SurveyVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'survey_version_id',
    foreignKeyConstraintName: 'FK_survey_submissions_version',
  })
  surveyVersion: SurveyVersion;

  @Column({ name: 'original_respondent_id', type: 'uuid', nullable: true })
  originalRespondentId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'original_respondent_id',
    foreignKeyConstraintName: 'FK_survey_submissions_respondent',
  })
  originalRespondent: User | null;

  @Column({ name: 'original_respondent_snapshot', type: 'jsonb' })
  originalRespondentSnapshot: RespondentSnapshot;

  @Column({
    type: 'enum',
    enum: SubmissionStatus,
    default: SubmissionStatus.Draft,
  })
  status: SubmissionStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'last_saved_at', type: 'timestamptz', nullable: true })
  lastSavedAt: Date | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @OneToMany(() => SurveyAnswer, (answer) => answer.submission)
  answers: SurveyAnswer[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

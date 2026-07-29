import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SurveyVersion } from '../../surveys/entities/survey-version.entity';
import { CampaignStatus } from './campaign-status.enum';
import { CampaignType } from './campaign-type.enum';

@Entity({ name: 'campaigns' })
@Index('IDX_campaigns_status_dates', ['status', 'startsAt', 'endsAt'])
@Check('CHK_campaigns_date_range', '"ends_at" > "starts_at"')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: CampaignType })
  type: CampaignType;

  @Column({
    type: 'enum',
    enum: CampaignStatus,
    default: CampaignStatus.Draft,
  })
  status: CampaignStatus;

  @Column({ name: 'survey_version_id', type: 'uuid' })
  surveyVersionId: string;

  @ManyToOne(() => SurveyVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'survey_version_id',
    foreignKeyConstraintName: 'FK_campaigns_survey_version',
  })
  surveyVersion: SurveyVersion;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

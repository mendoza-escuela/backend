import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { Campaign } from './campaign.entity';

export enum CampaignSchoolAssignmentSource {
  Manual = 'manual',
  Filter = 'filter',
  Bulk = 'bulk',
}

@Entity({ name: 'campaign_schools' })
@Index('UQ_campaign_schools_campaign_school', ['campaignId', 'schoolId'], {
  unique: true,
})
@Index('IDX_campaign_schools_campaign_current', ['campaignId', 'removedAt'])
@Index('IDX_campaign_schools_school_current', ['schoolId', 'removedAt'])
export class CampaignSchool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'campaign_id',
    foreignKeyConstraintName: 'FK_campaign_schools_campaign',
  })
  campaign: Campaign;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'school_id',
    foreignKeyConstraintName: 'FK_campaign_schools_school',
  })
  school: School;

  /** Nulo únicamente para las asignaciones históricas creadas por migración. */
  @Column({ name: 'assigned_by_user_id', type: 'uuid', nullable: true })
  assignedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'assigned_by_user_id',
    foreignKeyConstraintName: 'FK_campaign_schools_assigned_by',
  })
  assignedBy: User | null;

  @Column({ name: 'assigned_at', type: 'timestamptz' })
  assignedAt: Date;

  @Column({
    name: 'assignment_source',
    type: 'enum',
    enum: CampaignSchoolAssignmentSource,
  })
  assignmentSource: CampaignSchoolAssignmentSource;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt: Date | null;

  @Column({
    name: 'removal_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  removalReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

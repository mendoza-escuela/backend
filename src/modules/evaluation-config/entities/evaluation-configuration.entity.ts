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
import { User } from '../../users/entities/user.entity';
import { EvaluationConfigurationStatus } from './evaluation-configuration-status.enum';
import { EvaluationStarRange } from './evaluation-star-range.entity';

@Entity({ name: 'evaluation_configurations' })
@Index('UQ_evaluation_configurations_version_code', ['versionCode'], {
  unique: true,
})
@Index('UQ_evaluation_configurations_single_active', ['status'], {
  unique: true,
  where: `"status" = 'active'`,
})
@Check(
  'CHK_evaluation_configurations_threshold',
  '"mental_health_critical_threshold" >= 0 AND "mental_health_critical_threshold" <= 100',
)
@Check(
  'CHK_evaluation_configurations_max_stars',
  '"mental_health_max_stars" >= 1 AND "mental_health_max_stars" <= 5',
)
export class EvaluationConfiguration {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'version_code', type: 'varchar', length: 50 })
  versionCode: string;
  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({
    type: 'enum',
    enum: EvaluationConfigurationStatus,
    default: EvaluationConfigurationStatus.Draft,
  })
  status: EvaluationConfigurationStatus;
  @Column({
    name: 'mental_health_critical_threshold',
    type: 'numeric',
    precision: 11,
    scale: 8,
  })
  mentalHealthCriticalThreshold: string;
  @Column({ name: 'mental_health_max_stars', type: 'smallint' })
  mentalHealthMaxStars: number;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) metadata: Record<
    string,
    unknown
  >;
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'FK_evaluation_configurations_created_by',
  })
  createdBy: User | null;
  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;
  @Column({ name: 'activated_by_user_id', type: 'uuid', nullable: true })
  activatedByUserId: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'activated_by_user_id',
    foreignKeyConstraintName: 'FK_evaluation_configurations_activated_by',
  })
  activatedBy: User | null;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;
  @Column({ name: 'archived_by_user_id', type: 'uuid', nullable: true })
  archivedByUserId: string | null;
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'archived_by_user_id',
    foreignKeyConstraintName: 'FK_evaluation_configurations_archived_by',
  })
  archivedBy: User | null;
  @OneToMany(() => EvaluationStarRange, (range) => range.configuration, {
    cascade: true,
  })
  starRanges: EvaluationStarRange[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

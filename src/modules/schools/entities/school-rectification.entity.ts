import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SchoolRectificationEducationLevel } from './school-rectification-education-level.entity';
import { School } from './school.entity';

type SchoolCatalogSnapshot = {
  id: string;
  code: string;
  label: string;
};

type SchoolEducationLevelSnapshot = SchoolCatalogSnapshot & {
  enrollment: number | null;
};

export type SchoolRectificationSnapshot = {
  schemaVersion?: number;
  sourceRectificationId?: string;
  capturedAt?: string;
  name: string;
  cue: string;
  schoolNumber?: string | null;
  directorName: string;
  department?: string;
  address: string;
  postalCode?: string | null;
  locality: string;
  managementType?: string;
  scope: string;
  educationLevel: string;
  shift: string;
  phone?: string | null;
  email?: string | null;
  hasKiosk?: boolean | null;
  hasFoodService?: boolean | null;
  isBoarding?: boolean | null;
  characteristics?: Record<string, string | number | boolean | null>;
  shiftCatalog?: SchoolCatalogSnapshot | null;
  educationLevels?: SchoolEducationLevelSnapshot[];
  enrollmentTotal?: number | null;
  contacts?: Array<{
    type: 'RESPONDENT' | 'HEALTH_PROMOTION';
    firstName: string;
    lastName: string;
    position: string | null;
    phone: string | null;
    email: string | null;
  }>;
};

@Entity({ name: 'school_rectifications' })
@Index('IDX_school_rectifications_school_period', [
  'schoolId',
  'periodYear',
  'rectifiedAt',
])
export class SchoolRectification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'school_id' })
  school: School;

  @Column({ name: 'period_year', type: 'integer' })
  periodYear: number;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User | null;

  @Column({ type: 'jsonb' })
  snapshot: SchoolRectificationSnapshot;

  @OneToMany(
    () => SchoolRectificationEducationLevel,
    (level) => level.rectification,
  )
  educationLevels: SchoolRectificationEducationLevel[];

  @CreateDateColumn({ name: 'rectified_at', type: 'timestamptz' })
  rectifiedAt: Date;
}

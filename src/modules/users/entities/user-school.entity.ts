import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { User } from './user.entity';

@Entity({ name: 'user_schools' })
@Index('IDX_user_schools_one_school_per_user', ['userId'], { unique: true })
@Index('IDX_user_schools_one_user_per_school', ['schoolId'], { unique: true })
export class UserSchool {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => User, (user) => user.userSchools, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => School, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'school_id' })
  school: School;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

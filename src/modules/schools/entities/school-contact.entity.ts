import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { School } from './school.entity';

export enum SchoolContactType {
  Respondent = 'RESPONDENT',
  HealthPromotion = 'HEALTH_PROMOTION',
}

@Entity({ name: 'school_contacts' })
@Index('UQ_school_contacts_school_type', ['schoolId', 'type'], {
  unique: true,
})
export class SchoolContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, (school) => school.contacts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'school_id',
    foreignKeyConstraintName: 'FK_school_contacts_school',
  })
  school: School;

  @Column({ type: 'enum', enum: SchoolContactType })
  type: SchoolContactType;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  position: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

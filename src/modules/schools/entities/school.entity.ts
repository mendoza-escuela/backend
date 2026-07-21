import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'schools' })
export class School {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  cue: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index()
  @Column({
    name: 'school_number',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  schoolNumber: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  department: string;

  @Index()
  @Column({ type: 'varchar', length: 120 })
  locality: string;

  @Column({ type: 'varchar', length: 255 })
  address: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode: string | null;

  @Index()
  @Column({ name: 'education_level', type: 'varchar', length: 120 })
  educationLevel: string;

  @Index()
  @Column({ name: 'management_type', type: 'varchar', length: 120 })
  managementType: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  scope: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  shift: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ name: 'referent_first_name', type: 'varchar', length: 100 })
  referentFirstName: string;

  @Column({ name: 'referent_last_name', type: 'varchar', length: 100 })
  referentLastName: string;

  @Column({
    name: 'referent_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  referentEmail: string | null;

  @Column({
    name: 'referent_phone',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  referentPhone: string | null;

  @Column({ type: 'integer', default: 0 })
  enrollment: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  characteristics: Record<string, string | number | boolean | null>;

  @Index()
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

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
import { SchoolEducationLevel } from './school-education-level.entity';
import { SchoolShiftCatalog } from './school-shift-catalog.entity';

@Entity({ name: 'schools' })
@Index('IDX_schools_created_at_id', ['createdAt', 'id'])
@Check(
  'CHK_schools_enrollment',
  '"enrollment" IS NULL OR ("enrollment" >= 0 AND "enrollment" <= 1000000)',
)
export class School {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  cue: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'director_name', type: 'varchar', length: 200 })
  directorName: string;

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

  @Column({ type: 'varchar', length: 120 })
  scope: string;

  @Column({ type: 'varchar', length: 120 })
  shift: string;

  @Column({ name: 'shift_catalog_id', type: 'uuid', nullable: true })
  shiftCatalogId: string | null;

  @ManyToOne(() => SchoolShiftCatalog, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'shift_catalog_id',
    foreignKeyConstraintName: 'FK_schools_shift_catalog',
  })
  shiftCatalog: SchoolShiftCatalog | null;

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

  @Column({ type: 'integer', nullable: true })
  enrollment: number | null;

  @Column({ name: 'has_kiosk', type: 'boolean', nullable: true })
  hasKiosk: boolean | null;

  @Column({ name: 'has_food_service', type: 'boolean', nullable: true })
  hasFoodService: boolean | null;

  @Column({ name: 'is_boarding', type: 'boolean', nullable: true })
  isBoarding: boolean | null;

  @OneToMany(() => SchoolEducationLevel, (level) => level.school)
  structuredEducationLevels: SchoolEducationLevel[];

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

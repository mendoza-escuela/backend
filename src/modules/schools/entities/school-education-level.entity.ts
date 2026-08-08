import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EducationLevelCatalog } from './education-level-catalog.entity';
import { School } from './school.entity';

@Entity({ name: 'school_education_levels' })
@Index('UQ_school_education_levels_school_level', ['schoolId', 'levelId'], {
  unique: true,
})
@Index('UQ_school_education_levels_school_order', ['schoolId', 'order'], {
  unique: true,
})
@Check(
  'CHK_school_education_levels_enrollment',
  '"enrollment" IS NULL OR ("enrollment" >= 0 AND "enrollment" <= 1000000)',
)
@Check('CHK_school_education_levels_order', '"order" >= 0')
export class SchoolEducationLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'school_id', type: 'uuid' })
  schoolId: string;

  @ManyToOne(() => School, (school) => school.structuredEducationLevels, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'school_id',
    foreignKeyConstraintName: 'FK_school_education_levels_school',
  })
  school: School;

  @Column({ name: 'level_id', type: 'uuid' })
  levelId: string;

  @ManyToOne(() => EducationLevelCatalog, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'level_id',
    foreignKeyConstraintName: 'FK_school_education_levels_level',
  })
  level: EducationLevelCatalog;

  @Column({ type: 'integer', nullable: true })
  enrollment: number | null;

  @Column({ type: 'integer' })
  order: number;
}

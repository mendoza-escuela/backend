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
import { SchoolRectification } from './school-rectification.entity';

@Entity({ name: 'school_rectification_education_levels' })
@Index(
  'UQ_school_rectification_levels_rectification_level',
  ['rectificationId', 'levelId'],
  { unique: true },
)
@Index(
  'UQ_school_rectification_levels_rectification_order',
  ['rectificationId', 'order'],
  { unique: true },
)
@Check(
  'CHK_school_rectification_levels_enrollment',
  '"enrollment" IS NULL OR ("enrollment" >= 0 AND "enrollment" <= 1000000)',
)
@Check('CHK_school_rectification_levels_order', '"order" >= 0')
export class SchoolRectificationEducationLevel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rectification_id', type: 'uuid' })
  rectificationId: string;

  @ManyToOne(
    () => SchoolRectification,
    (rectification) => rectification.educationLevels,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({
    name: 'rectification_id',
    foreignKeyConstraintName: 'FK_school_rectification_levels_rectification',
  })
  rectification: SchoolRectification;

  @Column({ name: 'level_id', type: 'uuid' })
  levelId: string;

  @ManyToOne(() => EducationLevelCatalog, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'level_id',
    foreignKeyConstraintName: 'FK_school_rectification_levels_level',
  })
  level: EducationLevelCatalog;

  @Column({ name: 'level_code', type: 'varchar', length: 80 })
  levelCode: string;

  @Column({ name: 'level_label', type: 'varchar', length: 160 })
  levelLabel: string;

  @Column({ type: 'integer', nullable: true })
  enrollment: number | null;

  @Column({ type: 'integer' })
  order: number;
}

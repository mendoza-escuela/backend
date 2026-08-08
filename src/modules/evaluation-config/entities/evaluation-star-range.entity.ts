import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EvaluationConfiguration } from './evaluation-configuration.entity';

@Entity({ name: 'evaluation_star_ranges' })
@Index('UQ_evaluation_star_ranges_config_stars', ['configurationId', 'stars'], {
  unique: true,
})
@Index('UQ_evaluation_star_ranges_config_order', ['configurationId', 'order'], {
  unique: true,
})
@Check('CHK_evaluation_star_ranges_stars', '"stars" >= 1 AND "stars" <= 5')
@Check(
  'CHK_evaluation_star_ranges_limits',
  '"lower_bound" >= 0 AND "upper_bound" <= 100 AND "lower_bound" <= "upper_bound"',
)
export class EvaluationStarRange {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'configuration_id', type: 'uuid' }) configurationId: string;
  @ManyToOne(
    () => EvaluationConfiguration,
    (configuration) => configuration.starRanges,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({
    name: 'configuration_id',
    foreignKeyConstraintName: 'FK_evaluation_star_ranges_configuration',
  })
  configuration: EvaluationConfiguration;
  @Column({ type: 'smallint' }) stars: number;
  @Column({ name: 'lower_bound', type: 'numeric', precision: 11, scale: 8 })
  lowerBound: string;
  @Column({ name: 'upper_bound', type: 'numeric', precision: 11, scale: 8 })
  upperBound: string;
  @Column({ name: 'lower_inclusive', type: 'boolean' }) lowerInclusive: boolean;
  @Column({ name: 'upper_inclusive', type: 'boolean' }) upperInclusive: boolean;
  @Column({ type: 'smallint' }) order: number;
}

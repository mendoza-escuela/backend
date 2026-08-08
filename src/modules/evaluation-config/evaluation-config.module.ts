import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { AdminEvaluationConfigurationsController } from './controllers/admin-evaluation-configurations.controller';
import { EvaluationConfiguration } from './entities/evaluation-configuration.entity';
import { EvaluationStarRange } from './entities/evaluation-star-range.entity';
import { EvaluationConfigurationValidator } from './services/evaluation-configuration-validator.service';
import { EvaluationConfigurationsService } from './services/evaluation-configurations.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      EvaluationConfiguration,
      EvaluationStarRange,
      AuditLog,
    ]),
  ],
  controllers: [AdminEvaluationConfigurationsController],
  providers: [
    EvaluationConfigurationValidator,
    EvaluationConfigurationsService,
  ],
  exports: [EvaluationConfigurationsService],
})
export class EvaluationConfigModule {}

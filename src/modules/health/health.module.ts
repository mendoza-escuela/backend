import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';
import { AuditModule } from '../audit/audit.module';
import { AuthGuardsModule } from '../../common/guards/auth-guards.module';
import { AdminMonitoringController } from './controllers/admin-monitoring.controller';
import { MonitoringService } from './services/monitoring.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuditModule, AuthGuardsModule, MailModule],
  controllers: [HealthController, AdminMonitoringController],
  providers: [HealthService, MonitoringService],
})
export class HealthModule {}

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthGuardsModule } from '../../common/guards/auth-guards.module';
import { AdminAuditController } from './controllers/admin-audit.controller';
import { AuditMiddleware } from './audit.middleware';
import { AuditService } from './services/audit.service';

@Module({
  imports: [AuthGuardsModule],
  controllers: [AdminAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditMiddleware).forRoutes('*');
  }
}

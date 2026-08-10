import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { CampaignSchool } from '../campaigns/entities/campaign-school.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { AdminExportsController } from './controllers/admin-exports.controller';
import { AdminExportsService } from './services/admin-exports.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Campaign, CampaignSchool, AuditLog]),
  ],
  controllers: [AdminExportsController],
  providers: [AdminExportsService],
})
export class ExportsModule {}

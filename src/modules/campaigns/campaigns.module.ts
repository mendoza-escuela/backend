import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { SurveyVersion } from '../surveys/entities/survey-version.entity';
import { AdminCampaignsController } from './controllers/admin-campaigns.controller';
import { Campaign } from './entities/campaign.entity';
import { CampaignsService } from './services/campaigns.service';
import { CampaignTrackingService } from './services/campaign-tracking.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Campaign, SurveyVersion, AuditLog]),
  ],
  controllers: [AdminCampaignsController],
  providers: [CampaignsService, CampaignTrackingService],
  exports: [CampaignsService],
})
export class CampaignsModule {}

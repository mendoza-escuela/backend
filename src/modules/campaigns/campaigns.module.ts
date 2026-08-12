import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { SurveySubmission } from '../submissions/entities/survey-submission.entity';
import { SurveyVersion } from '../surveys/entities/survey-version.entity';
import { AdminCampaignsController } from './controllers/admin-campaigns.controller';
import { CampaignSchool } from './entities/campaign-school.entity';
import { Campaign } from './entities/campaign.entity';
import { CampaignSchoolsService } from './services/campaign-schools.service';
import { CampaignsService } from './services/campaigns.service';
import { CampaignTrackingService } from './services/campaign-tracking.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Campaign,
      CampaignSchool,
      School,
      SurveySubmission,
      SurveyVersion,
      AuditLog,
    ]),
  ],
  controllers: [AdminCampaignsController],
  providers: [
    CampaignsService,
    CampaignTrackingService,
    CampaignSchoolsService,
  ],
  exports: [CampaignsService, CampaignSchoolsService],
})
export class CampaignsModule {}

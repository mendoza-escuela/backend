import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { CampaignSchool } from '../campaigns/entities/campaign-school.entity';
import { EvaluationResult } from '../evaluation/entities/evaluation-result.entity';
import { School } from '../schools/entities/school.entity';
import { SurveySubmission } from '../submissions/entities/survey-submission.entity';
import { UserSchool } from '../users/entities/user-school.entity';
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { AdminResultsDashboardController } from './controllers/admin-results-dashboard.controller';
import { SchoolResultsDashboardController } from './controllers/school-results-dashboard.controller';
import { ParticipationDashboardService } from './services/participation-dashboard.service';
import { ResultsDashboardService } from './services/results-dashboard.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Campaign,
      CampaignSchool,
      EvaluationResult,
      School,
      SurveySubmission,
      UserSchool,
    ]),
  ],
  controllers: [
    AdminDashboardController,
    AdminResultsDashboardController,
    SchoolResultsDashboardController,
  ],
  providers: [ParticipationDashboardService, ResultsDashboardService],
})
export class DashboardModule {}

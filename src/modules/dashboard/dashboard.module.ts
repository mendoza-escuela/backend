import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { School } from '../schools/entities/school.entity';
import { SurveySubmission } from '../submissions/entities/survey-submission.entity';
import { AdminDashboardController } from './controllers/admin-dashboard.controller';
import { ParticipationDashboardService } from './services/participation-dashboard.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([Campaign, School, SurveySubmission]),
  ],
  controllers: [AdminDashboardController],
  providers: [ParticipationDashboardService],
})
export class DashboardModule {}

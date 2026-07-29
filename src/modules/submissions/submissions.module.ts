import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { SchoolsModule } from '../schools/schools.module';
import { SchoolSubmissionsController } from './controllers/school-submissions.controller';
import { SurveyAnswer } from './entities/survey-answer.entity';
import { SurveySubmission } from './entities/survey-submission.entity';
import { SubmissionsService } from './services/submissions.service';

@Module({
  imports: [
    AuthModule,
    CampaignsModule,
    SchoolsModule,
    TypeOrmModule.forFeature([SurveySubmission, SurveyAnswer, AuditLog]),
  ],
  controllers: [SchoolSubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}

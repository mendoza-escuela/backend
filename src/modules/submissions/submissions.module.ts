import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { SchoolsModule } from '../schools/schools.module';
import { SurveysModule } from '../surveys/surveys.module';
import { SchoolSubmissionsController } from './controllers/school-submissions.controller';
import { SurveyAnswer } from './entities/survey-answer.entity';
import { SurveySubmission } from './entities/survey-submission.entity';
import { SubmissionQuestionApplicability } from './entities/submission-question-applicability.entity';
import { SubmissionsService } from './services/submissions.service';

@Module({
  imports: [
    AuthModule,
    CampaignsModule,
    EvaluationModule,
    SchoolsModule,
    SurveysModule,
    TypeOrmModule.forFeature([
      SurveySubmission,
      SurveyAnswer,
      SubmissionQuestionApplicability,
      AuditLog,
    ]),
  ],
  controllers: [SchoolSubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}

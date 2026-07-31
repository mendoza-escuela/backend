import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SchoolsModule } from '../schools/schools.module';
import { EvaluationConfigModule } from '../evaluation-config/evaluation-config.module';
import { SurveyAnswer } from '../submissions/entities/survey-answer.entity';
import { SurveySubmission } from '../submissions/entities/survey-submission.entity';
import { SubmissionQuestionApplicability } from '../submissions/entities/submission-question-applicability.entity';
import { SurveysModule } from '../surveys/surveys.module';
import {
  SchoolEvaluationResultsController,
  SchoolPreliminaryResultsController,
} from './controllers/school-evaluation-results.controller';
import { EvaluationDimensionResult } from './entities/evaluation-dimension-result.entity';
import { EvaluationResult } from './entities/evaluation-result.entity';
import { EvaluationResultsService } from './services/evaluation-results.service';
import { AdminSchoolResultDetailController } from './controllers/admin-school-result-detail.controller';
import { AdminSchoolResultDetailService } from './services/admin-school-result-detail.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EvaluationResult,
      EvaluationDimensionResult,
      SurveySubmission,
      SurveyAnswer,
      SubmissionQuestionApplicability,
    ]),
    AuthModule,
    SchoolsModule,
    SurveysModule,
    EvaluationConfigModule,
  ],
  controllers: [
    AdminSchoolResultDetailController,
    SchoolEvaluationResultsController,
    SchoolPreliminaryResultsController,
  ],
  providers: [EvaluationResultsService, AdminSchoolResultDetailService],
  exports: [EvaluationResultsService],
})
export class EvaluationModule {}

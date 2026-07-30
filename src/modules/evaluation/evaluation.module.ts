import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SchoolsModule } from '../schools/schools.module';
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
  ],
  controllers: [
    SchoolEvaluationResultsController,
    SchoolPreliminaryResultsController,
  ],
  providers: [EvaluationResultsService],
  exports: [EvaluationResultsService],
})
export class EvaluationModule {}

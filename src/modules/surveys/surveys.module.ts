import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminSurveysController } from './controllers/admin-surveys.controller';
import { SurveysController } from './controllers/surveys.controller';
import { SurveyDimension } from './entities/survey-dimension.entity';
import { SurveyOption } from './entities/survey-option.entity';
import { SurveyQuestion } from './entities/survey-question.entity';
import { SurveySection } from './entities/survey-section.entity';
import { SurveyVersion } from './entities/survey-version.entity';
import { Survey } from './entities/survey.entity';
import { SurveysService } from './services/surveys.service';
import { AdminSurveysService } from './services/admin-surveys.service';
import { SurveyStructureValidator } from './services/survey-structure-validator.service';
import { SurveyVersionComparator } from './services/survey-version-comparator.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Survey,
      SurveyVersion,
      SurveyDimension,
      SurveySection,
      SurveyQuestion,
      SurveyOption,
      AuditLog,
    ]),
  ],
  controllers: [SurveysController, AdminSurveysController],
  providers: [
    SurveysService,
    AdminSurveysService,
    SurveyStructureValidator,
    SurveyVersionComparator,
  ],
  exports: [SurveysService],
})
export class SurveysModule {}

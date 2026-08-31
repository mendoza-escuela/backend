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
import { BulkSurveyImportService } from './services/bulk-survey-import.service';
import { SurveyImportFileService } from './services/survey-import-file.service';
import { SurveyApplicabilityRule } from './entities/survey-applicability-rule.entity';
import { SurveyApplicabilityCondition } from './entities/survey-applicability-condition.entity';
import { ApplicabilityEngine } from './services/applicability-engine.service';
import { ApplicabilityRulesService } from './services/applicability-rules.service';
import { SurveyEvaluationService } from './services/survey-evaluation.service';
import { SchoolRectification } from '../schools/entities/school-rectification.entity';
import { EducationLevelCatalog } from '../schools/entities/education-level-catalog.entity';
import { SchoolShiftCatalog } from '../schools/entities/school-shift-catalog.entity';
import { SurveyApplicabilityService } from './services/survey-applicability.service';

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
      SchoolRectification,
      SchoolShiftCatalog,
      EducationLevelCatalog,
      SurveyApplicabilityRule,
      SurveyApplicabilityCondition,
    ]),
  ],
  controllers: [SurveysController, AdminSurveysController],
  providers: [
    SurveysService,
    AdminSurveysService,
    SurveyStructureValidator,
    SurveyVersionComparator,
    BulkSurveyImportService,
    SurveyImportFileService,
    ApplicabilityEngine,
    ApplicabilityRulesService,
    SurveyApplicabilityService,
    SurveyEvaluationService,
  ],
  exports: [SurveyApplicabilityService, SurveyEvaluationService],
})
export class SurveysModule {}

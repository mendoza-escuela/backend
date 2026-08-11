import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { CampaignSchool } from '../campaigns/entities/campaign-school.entity';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { EvaluationResult } from '../evaluation/entities/evaluation-result.entity';
import { School } from '../schools/entities/school.entity';
import { SurveySubmission } from '../submissions/entities/survey-submission.entity';
import { UserSchool } from '../users/entities/user-school.entity';
import {
  AdminReportsController,
  SchoolReportsController,
} from './controllers/reports.controller';
import { IndividualReportService } from './services/individual-report.service';
import { PdfReportRenderer } from './services/pdf-report.renderer';
import { RadarSvgService } from './services/radar-svg.service';
import { ReportBrandingProvider } from './services/report-branding.provider';
import { XlsxReportRenderer } from './services/xlsx-report.renderer';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      AuditLog,
      Campaign,
      CampaignSchool,
      EvaluationResult,
      School,
      SurveySubmission,
      UserSchool,
    ]),
  ],
  controllers: [SchoolReportsController, AdminReportsController],
  providers: [
    IndividualReportService,
    PdfReportRenderer,
    RadarSvgService,
    ReportBrandingProvider,
    XlsxReportRenderer,
  ],
})
export class ReportsModule {}

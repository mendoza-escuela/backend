import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { EvaluationResult } from '../../evaluation/entities/evaluation-result.entity';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import type { IndividualReportViewModel } from '../report.types';
import { RadarSvgService } from './radar-svg.service';
import { ReportBrandingProvider } from './report-branding.provider';

@Injectable()
export class IndividualReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly branding: ReportBrandingProvider,
    private readonly radar: RadarSvgService,
  ) {}

  async get(campaignId: string, schoolId: string) {
    const assignment = await this.dataSource
      .getRepository(CampaignSchool)
      .findOne({ where: { campaignId, schoolId } });
    if (!assignment)
      throw new NotFoundException(
        'La escuela no pertenece al universo de esta campaña.',
      );
    const [campaign, school, submission] = await Promise.all([
      this.dataSource.getRepository(Campaign).findOneBy({ id: campaignId }),
      this.dataSource.getRepository(School).findOneBy({ id: schoolId }),
      this.dataSource.getRepository(SurveySubmission).findOne({
        where: { campaignId, schoolId, status: SubmissionStatus.Submitted },
      }),
    ]);
    if (!campaign || !school)
      throw new NotFoundException('No se encontraron los datos del reporte.');
    if (!submission)
      throw new NotFoundException('La presentación todavía no fue enviada.');
    const evaluation = await this.dataSource
      .getRepository(EvaluationResult)
      .findOneBy({ submissionId: submission.id });
    if (!evaluation?.snapshot)
      throw new NotFoundException(
        'La presentación no posee un resultado histórico disponible.',
      );
    const snapshot = evaluation.snapshot;
    const dimensions = snapshot.survey.dimensions
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((dimension) => ({
        title: dimension.title,
        score:
          dimension.result.score === null
            ? null
            : Number(dimension.result.score),
      }));
    const viewModel: IndividualReportViewModel = {
      school: snapshot.school,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt.toISOString(),
      },
      survey: snapshot.survey,
      submission: snapshot.submission,
      result: snapshot.result,
      algorithm: snapshot.algorithm,
      branding: this.branding.get(),
      radarSvg: this.radar.create(dimensions),
    };
    return viewModel;
  }
}

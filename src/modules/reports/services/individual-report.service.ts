import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { EvaluationResult } from '../../evaluation/entities/evaluation-result.entity';
import type { SchoolRectificationSnapshot } from '../../schools/entities/school-rectification.entity';
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
    const [campaign, submission] = await Promise.all([
      this.dataSource.getRepository(Campaign).findOneBy({ id: campaignId }),
      this.dataSource.getRepository(SurveySubmission).findOne({
        where: { campaignId, schoolId, status: SubmissionStatus.Submitted },
        relations: { schoolRectification: true },
      }),
    ]);
    if (!campaign)
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
    const rectificationSnapshot = this.trustedRectificationSnapshot(
      submission,
      snapshot.submission.schoolRectificationId,
    );
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
      school: this.historicalSchoolView(
        snapshot.school,
        submission.schoolProfileSnapshot,
        rectificationSnapshot,
      ),
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

  /**
   * Completa únicamente los campos territoriales ausentes del resultado con
   * fuentes vinculadas a la presentación. Nunca consulta la ficha escolar
   * vigente ni modifica ninguno de los snapshots persistidos.
   */
  private historicalSchoolView(
    evaluationSnapshot: SchoolRectificationSnapshot,
    submissionSnapshot: SchoolRectificationSnapshot | null,
    rectificationSnapshot?: SchoolRectificationSnapshot,
  ): IndividualReportViewModel['school'] {
    return {
      ...structuredClone(evaluationSnapshot),
      department: this.firstHistoricalText(
        evaluationSnapshot.department,
        submissionSnapshot?.department,
        rectificationSnapshot?.department,
      ),
      managementType: this.firstHistoricalText(
        evaluationSnapshot.managementType,
        submissionSnapshot?.managementType,
        rectificationSnapshot?.managementType,
      ),
    };
  }

  private firstHistoricalText(
    ...candidates: Array<string | null | undefined>
  ): string | undefined {
    return candidates
      .find(
        (candidate): candidate is string =>
          typeof candidate === 'string' && candidate.trim().length > 0,
      )
      ?.trim();
  }

  /**
   * Una rectificación sólo es una fuente histórica válida cuando la relación
   * cargada coincide con las claves persistidas de la presentación y escuela.
   * Los snapshots antiguos pueden no haber registrado el identificador; si lo
   * registraron, también debe coincidir.
   */
  private trustedRectificationSnapshot(
    submission: SurveySubmission,
    evaluationRectificationId: string | null | undefined,
  ): SchoolRectificationSnapshot | undefined {
    const rectification = submission.schoolRectification;
    if (
      !rectification ||
      !submission.schoolRectificationId ||
      rectification.id !== submission.schoolRectificationId ||
      rectification.schoolId !== submission.schoolId ||
      (evaluationRectificationId != null &&
        evaluationRectificationId !== submission.schoolRectificationId)
    ) {
      return undefined;
    }
    return rectification.snapshot;
  }
}

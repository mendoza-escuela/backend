import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { School } from '../../schools/entities/school.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { OFFICIAL_SURVEY_DIMENSIONS } from '../../surveys/templates/official-survey-dimensions.template';
import { ParticipationDashboardQueryDto } from '../dto/participation-dashboard-query.dto';

@Injectable()
export class ResultsDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async metrics(query: ParticipationDashboardQueryDto) {
    const campaign = await this.dataSource
      .getRepository(Campaign)
      .findOneBy({ id: query.campaignId });
    if (!campaign) throw new NotFoundException('Campaña no encontrada.');
    if (campaign.status === CampaignStatus.Draft)
      throw new ConflictException(
        'Las campañas en borrador no poseen métricas de resultados.',
      );
    const base = this.base(query)
      .select('COUNT(DISTINCT school.id)', 'universeSchools')
      .addSelect(
        'COUNT(DISTINCT submission.school_id) FILTER (WHERE submission.status = :submitted)',
        'submittedSchools',
      )
      .addSelect(
        'COUNT(DISTINCT evaluation.school_id) FILTER (WHERE evaluation.id IS NOT NULL)',
        'schoolsWithResult',
      )
      .addSelect('AVG(evaluation.general_score)', 'generalAverage')
      .addSelect(
        'COUNT(evaluation.id) FILTER (WHERE evaluation.stars IS NULL)',
        'resultsWithoutStars',
      )
      .setParameter('submitted', SubmissionStatus.Submitted);
    for (let stars = 1; stars <= 5; stars += 1)
      base.addSelect(
        `COUNT(evaluation.id) FILTER (WHERE evaluation.stars = ${stars})`,
        `stars${stars}`,
      );
    const row = await base.getRawOne<Record<string, string | null>>();
    const dimensionBuilder = this.base(query)
      .innerJoin(
        'evaluation_dimension_results',
        'dimension_result',
        'dimension_result.result_id = evaluation.id',
      )
      .select('dimension_result.dimension_code', 'code')
      .addSelect('AVG(dimension_result.score)', 'average')
      .where('school.is_active = true')
      .andWhere('evaluation.id IS NOT NULL')
      .andWhere('dimension_result.score IS NOT NULL')
      .groupBy('dimension_result.dimension_code');
    this.applyFilters(dimensionBuilder, query);
    const dimensionRows = await dimensionBuilder.getRawMany<{
      code: string;
      average: string;
    }>();
    const resultDenominator = Number(row?.schoolsWithResult ?? 0);
    const starDenominator = [1, 2, 3, 4, 5].reduce(
      (total, stars) => total + Number(row?.[`stars${stars}`] ?? 0),
      0,
    );
    const distribution = [1, 2, 3, 4, 5].map((stars) => {
      const count = Number(row?.[`stars${stars}`] ?? 0);
      return {
        stars,
        label: `${stars} estrella${stars === 1 ? '' : 's'}`,
        count,
        percentage: starDenominator
          ? this.round((count / starDenominator) * 100)
          : 0,
        denominator: starDenominator,
      };
    });
    const dimensionByCode = new Map(
      dimensionRows.map(({ code, average }) => [code, this.number(average)]),
    );
    const universeSchools = Number(row?.universeSchools ?? 0);
    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
      },
      denominators: {
        universeSchools,
        submittedSchools: Number(row?.submittedSchools ?? 0),
        schoolsWithCurrentResult: resultDenominator,
        averages: resultDenominator,
        starDistribution: starDenominator,
      },
      metrics: {
        universeSchools,
        schoolsWithResult: resultDenominator,
        coveragePercentage: universeSchools
          ? this.round((resultDenominator / universeSchools) * 100)
          : 0,
        generalAverage: this.number(row?.generalAverage),
        dimensionAverages: OFFICIAL_SURVEY_DIMENSIONS.map((dimension) => ({
          code: dimension.code,
          title: dimension.title,
          order: dimension.order,
          average: dimensionByCode.get(dimension.code) ?? null,
        })),
      },
      starDistribution: distribution,
      excludedResultsWithoutStars: Number(row?.resultsWithoutStars ?? 0),
    };
  }

  async distribution(query: ParticipationDashboardQueryDto) {
    const response = await this.metrics(query);
    return {
      denominator: response.denominators.starDistribution,
      excludedResultsWithoutStars: response.excludedResultsWithoutStars,
      items: response.starDistribution,
    };
  }

  private base(query: ParticipationDashboardQueryDto) {
    const builder = this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .leftJoin(
        'survey_submissions',
        'submission',
        'submission.school_id = school.id AND submission.campaign_id = :campaignId',
        { campaignId: query.campaignId },
      )
      .leftJoin(
        'evaluation_results',
        'evaluation',
        'evaluation.submission_id = submission.id AND submission.status = :submittedStatus',
        { submittedStatus: SubmissionStatus.Submitted },
      )
      .where('school.is_active = true');
    this.applyFilters(builder, query);
    return builder;
  }
  private applyFilters(
    builder: SelectQueryBuilder<School>,
    query: ParticipationDashboardQueryDto,
  ) {
    const filters: Array<[keyof ParticipationDashboardQueryDto, string]> = [
      ['schoolId', 'school.id'],
      ['department', 'school.department'],
      ['locality', 'school.locality'],
      ['educationLevel', 'school.education_level'],
      ['managementType', 'school.management_type'],
      ['scope', 'school.scope'],
      ['shift', 'school.shift'],
    ];
    for (const [property, column] of filters)
      if (query[property])
        builder.andWhere(`${column} = :${property}`, {
          [property]: query[property],
        });
  }
  private number(value: string | null | undefined) {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? this.round(number) : null;
  }
  private round(value: number) {
    return Math.round(value * 100) / 100;
  }
}

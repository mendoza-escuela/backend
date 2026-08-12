import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { multiValueFilter } from '../../../common/transforms/multi-value-query.transform';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { School } from '../../schools/entities/school.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { OFFICIAL_SURVEY_DIMENSIONS } from '../../surveys/templates/official-survey-dimensions.template';
import {
  CriticalAlertsDashboardQueryDto,
  ParticipationDashboardQueryDto,
  ResultsComparisonDashboardQueryDto,
} from '../dto/participation-dashboard-query.dto';
import { applyDashboardSchoolFilters } from '../dashboard-query-filters';

type ResultMetricsRow = Record<string, string | null> & {
  universeSchools: string;
  submittedSchools: string;
  schoolsWithResult: string;
  generalAverage: string | null;
  resultsWithoutStars: string;
  algorithmVersion: string | null;
  evaluationConfigurationVersion: string | null;
  calculatedAt: Date | string | null;
  calculationSource: string | null;
};

type DimensionAverageRow = {
  code: string;
  title: string;
  order: string;
  average: string;
  denominator: string;
};

type RadarComparisonReason =
  | 'single_school_required'
  | 'missing_result'
  | 'different_survey_version'
  | 'different_algorithm_version'
  | 'unknown_calculation_metadata';

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
    return (await this.metricsForCampaign(campaign, query)).response;
  }

  /**
   * Compara entre dos y seis campañas sin mezclar sus universos. El primer ID
   * solicitado es la línea de base y el orden de entrada se conserva.
   *
   * Puntaje general y estrellas son las métricas históricas estandarizadas. La
   * serie dimensional se construye desde los resultados persistidos y sólo se
   * marca comparable para una escuela con instrumento y algoritmo equivalentes.
   */
  async comparison(query: ResultsComparisonDashboardQueryDto) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return this.comparisonWithinSnapshot(query, manager);
    });
  }

  private async comparisonWithinSnapshot(
    query: ResultsComparisonDashboardQueryDto,
    manager: EntityManager,
  ) {
    const campaigns = await manager.getRepository(Campaign).find({
      where: { id: In(query.campaignIds) },
    });
    const campaignById = new Map(
      campaigns.map((campaign) => [campaign.id, campaign]),
    );
    const orderedCampaigns = query.campaignIds.map((campaignId) =>
      campaignById.get(campaignId),
    );
    if (orderedCampaigns.some((campaign) => !campaign))
      throw new NotFoundException('Una o más campañas no fueron encontradas.');
    const draftCampaigns = orderedCampaigns.filter(
      (campaign) => campaign?.status === CampaignStatus.Draft,
    );
    if (draftCampaigns.length)
      throw new ConflictException(
        'Las campañas en borrador no poseen métricas comparables.',
      );

    const filters = query;
    const periodMetrics: Array<
      Awaited<ReturnType<typeof this.metricsForCampaign>>
    > = [];
    for (const campaign of orderedCampaigns)
      periodMetrics.push(
        await this.metricsForCampaign(
          campaign!,
          {
            ...filters,
            campaignId: campaign!.id,
          },
          manager,
        ),
      );
    const selectedSchoolIds = multiValueFilter(query.schoolIds, query.schoolId);
    const periods = periodMetrics.map(
      ({ response, persistedDimensions, calculationMetadata }) => ({
        campaign: response.campaign,
        denominators: response.denominators,
        metrics: {
          ...response.metrics,
          dimensionAverages:
            selectedSchoolIds.length === 1 ? persistedDimensions : [],
        },
        starDistribution: response.starDistribution,
        excludedResultsWithoutStars: response.excludedResultsWithoutStars,
        calculationMetadata:
          selectedSchoolIds.length === 1
            ? calculationMetadata
            : {
                algorithmVersion: null,
                evaluationConfigurationVersion: null,
                calculatedAt: null,
                calculationSource: null,
              },
      }),
    );
    const radarComparison = this.radarComparison(
      selectedSchoolIds,
      orderedCampaigns as Campaign[],
      periods,
    );

    return {
      baselineCampaignId: query.campaignIds[0],
      comparisonPolicy: {
        standardizedMetrics: ['generalScore', 'stars'],
        dimensionSeries: 'visual_trajectory',
        cohortMode: 'independent_campaign_universes',
        schoolProfileSource: 'current',
        filterScope: 'institutional_only',
        excludedOutcomeFilters: [
          'submissionStatuses',
          'stars',
          'criticalAreas',
        ],
        notice:
          'Cada campaña conserva su propio universo y usa la ficha escolar vigente. El puntaje general y las estrellas son las métricas históricas estandarizadas; el radar sólo representa la trayectoria de una escuela y puede no ser comparable si cambian el cuestionario o el algoritmo dimensional.',
      },
      radarComparison,
      commonDimensions: this.commonDimensions(periods),
      periods,
    };
  }

  private async metricsForCampaign(
    campaign: Campaign,
    query: ParticipationDashboardQueryDto,
    source: DataSource | EntityManager = this.dataSource,
  ) {
    const base = this.base(query, source)
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
      .addSelect('MIN(evaluation.algorithm_version)', 'algorithmVersion')
      .addSelect(
        'MIN(evaluation.evaluation_configuration_version)',
        'evaluationConfigurationVersion',
      )
      .addSelect('MAX(evaluation.calculated_at)', 'calculatedAt')
      .addSelect('MIN(evaluation.calculation_source)', 'calculationSource')
      .setParameter('submitted', SubmissionStatus.Submitted);
    for (let stars = 1; stars <= 5; stars += 1)
      base.addSelect(
        `COUNT(evaluation.id) FILTER (WHERE evaluation.stars = ${stars})`,
        `stars${stars}`,
      );
    const row = await base.getRawOne<ResultMetricsRow>();
    const dimensionBuilder = this.base(query, source)
      .innerJoin(
        'evaluation_dimension_results',
        'dimension_result',
        'dimension_result.result_id = evaluation.id',
      )
      .select('dimension_result.dimension_code', 'code')
      .addSelect('MAX(dimension_result.dimension_title)', 'title')
      .addSelect('MIN(dimension_result.order)', 'order')
      .addSelect('AVG(dimension_result.score)', 'average')
      .addSelect('COUNT(dimension_result.score)', 'denominator')
      .andWhere('evaluation.id IS NOT NULL')
      .andWhere('dimension_result.score IS NOT NULL')
      .groupBy('dimension_result.dimension_code');
    const dimensionRows =
      await dimensionBuilder.getRawMany<DimensionAverageRow>();
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
      dimensionRows.map(({ code, average, denominator }) => [
        code,
        { average: this.number(average), denominator: Number(denominator) },
      ]),
    );
    const universeSchools = Number(row?.universeSchools ?? 0);
    const response = {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        surveyVersionId: campaign.surveyVersionId,
        isPartial: campaign.status === CampaignStatus.Active,
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
          average: dimensionByCode.get(dimension.code)?.average ?? null,
          denominator: dimensionByCode.get(dimension.code)?.denominator ?? 0,
        })),
      },
      starDistribution: distribution,
      excludedResultsWithoutStars: Number(row?.resultsWithoutStars ?? 0),
    };
    return {
      response,
      persistedDimensions: dimensionRows
        .map(({ code, title, order, average, denominator }) => ({
          code,
          title,
          order: Number(order),
          average: this.number(average),
          denominator: Number(denominator),
        }))
        .sort((first, second) =>
          first.order === second.order
            ? first.code.localeCompare(second.code)
            : first.order - second.order,
        ),
      calculationMetadata: {
        algorithmVersion: row?.algorithmVersion ?? null,
        evaluationConfigurationVersion:
          row?.evaluationConfigurationVersion ?? null,
        calculatedAt: this.isoDate(row?.calculatedAt),
        calculationSource: row?.calculationSource ?? null,
      },
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

  /**
   * Consolida alertas por escuela sin contar una institución varias veces en
   * el total. El detalle conserva cada dimensión crítica para acceso directo.
   */
  async criticalAlerts(query: CriticalAlertsDashboardQueryDto) {
    const campaign = await this.dataSource
      .getRepository(Campaign)
      .findOneBy({ id: query.campaignId });
    if (!campaign) throw new NotFoundException('Campaña no encontrada.');
    if (campaign.status === CampaignStatus.Draft)
      throw new ConflictException(
        'Las campañas en borrador no poseen alertas de resultados.',
      );

    const totalsBuilder = this.criticalBase(query)
      .select('COUNT(DISTINCT school.id)', 'schoolsCount')
      .addSelect('COUNT(critical_dimension.id)', 'alertsCount');
    const denominatorBuilder = this.base({
      ...query,
      criticalAreas: undefined,
    }).select(
      'COUNT(DISTINCT evaluation.school_id) FILTER (WHERE evaluation.id IS NOT NULL)',
      'schoolsWithResult',
    );
    const dimensionsBuilder = this.criticalBase({
      ...query,
      dimensionCode: undefined,
    })
      .select('critical_dimension.dimension_code', 'code')
      .addSelect('critical_dimension.dimension_title', 'title')
      .addSelect('critical_dimension.order', 'order')
      .addSelect('COUNT(DISTINCT school.id)', 'schoolsCount')
      .groupBy('critical_dimension.dimension_code')
      .addGroupBy('critical_dimension.dimension_title')
      .addGroupBy('critical_dimension.order')
      .orderBy('critical_dimension.order', 'ASC');
    const itemsBuilder = this.criticalBase(query)
      .select('school.id', 'schoolId')
      .addSelect('school.cue', 'cue')
      .addSelect('school.name', 'schoolName')
      .addSelect('school.department', 'department')
      .addSelect('school.locality', 'locality')
      .addSelect('evaluation.general_score', 'generalScore')
      .addSelect('evaluation.stars', 'stars')
      .addSelect(
        `JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'code', critical_dimension.dimension_code,
            'title', critical_dimension.dimension_title,
            'score', critical_dimension.score,
            'threshold', critical_dimension.critical_threshold,
            'order', critical_dimension.order
          ) ORDER BY critical_dimension.order
        )`,
        'dimensions',
      )
      .groupBy('school.id')
      .addGroupBy('school.cue')
      .addGroupBy('school.name')
      .addGroupBy('school.department')
      .addGroupBy('school.locality')
      .addGroupBy('evaluation.id')
      .addGroupBy('evaluation.general_score')
      .addGroupBy('evaluation.stars')
      .orderBy('COUNT(critical_dimension.id)', 'DESC')
      .addOrderBy('LOWER(school.name)', 'ASC')
      .addOrderBy('school.id', 'ASC')
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    const [totals, denominator, dimensionRows, itemRows] = await Promise.all([
      totalsBuilder.getRawOne<{
        schoolsCount: string;
        alertsCount: string;
      }>(),
      denominatorBuilder.getRawOne<{ schoolsWithResult: string }>(),
      dimensionsBuilder.getRawMany<{
        code: string;
        title: string;
        order: string;
        schoolsCount: string;
      }>(),
      itemsBuilder.getRawMany<{
        schoolId: string;
        cue: string;
        schoolName: string;
        department: string | null;
        locality: string | null;
        generalScore: string;
        stars: string | null;
        dimensions: Array<{
          code: string;
          title: string;
          score: number | string;
          threshold: number | string | null;
          order: number;
        }>;
      }>(),
    ]);
    const schoolsCount = Number(totals?.schoolsCount ?? 0);
    const schoolsWithResult = Number(denominator?.schoolsWithResult ?? 0);
    return {
      summary: {
        schoolsCount,
        schoolsWithResult,
        schoolsPercentage: schoolsWithResult
          ? this.round((schoolsCount / schoolsWithResult) * 100)
          : 0,
        alertsCount: Number(totals?.alertsCount ?? 0),
        affectedDimensionCount: dimensionRows.length,
        affectedDimensions: dimensionRows.map((row) => ({
          code: row.code,
          title: row.title,
          order: Number(row.order),
          schoolsCount: Number(row.schoolsCount),
        })),
      },
      items: itemRows.map((row) => ({
        school: {
          id: row.schoolId,
          cue: row.cue,
          name: row.schoolName,
          department: row.department,
          locality: row.locality,
        },
        generalScore: this.number(row.generalScore),
        stars: row.stars === null ? null : Number(row.stars),
        dimensions: row.dimensions.map((dimension) => ({
          ...dimension,
          score: this.number(String(dimension.score)),
          threshold:
            dimension.threshold === null
              ? null
              : this.number(String(dimension.threshold)),
        })),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: schoolsCount,
        totalPages: Math.max(1, Math.ceil(schoolsCount / query.limit)),
      },
    };
  }

  private isoDate(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private radarComparison(
    selectedSchoolIds: string[],
    campaigns: Campaign[],
    periods: Array<{
      metrics: { schoolsWithResult: number };
      calculationMetadata: {
        algorithmVersion: string | null;
        evaluationConfigurationVersion: string | null;
      };
    }>,
  ) {
    let reason: RadarComparisonReason | null = null;
    if (selectedSchoolIds.length !== 1) reason = 'single_school_required';
    else if (periods.some((period) => period.metrics.schoolsWithResult !== 1))
      reason = 'missing_result';
    else if (
      new Set(campaigns.map((campaign) => campaign.surveyVersionId)).size !== 1
    )
      reason = 'different_survey_version';
    else if (
      periods.some((period) => !period.calculationMetadata.algorithmVersion)
    )
      reason = 'unknown_calculation_metadata';
    else if (
      new Set(
        periods.map((period) => period.calculationMetadata.algorithmVersion),
      ).size !== 1
    )
      reason = 'different_algorithm_version';

    const available =
      reason === null ||
      reason === 'different_survey_version' ||
      reason === 'different_algorithm_version' ||
      reason === 'unknown_calculation_metadata';
    return {
      available,
      comparable: reason === null,
      mode:
        reason === null
          ? 'comparable'
          : available
            ? 'descriptive'
            : 'unavailable',
      reason,
      selectedSchoolId:
        selectedSchoolIds.length === 1 ? selectedSchoolIds[0] : null,
    };
  }

  private commonDimensions(
    periods: Array<{
      metrics: {
        dimensionAverages: Array<{
          code: string;
          title: string;
          order: number;
          average: number | null;
          denominator: number;
        }>;
      };
    }>,
  ) {
    const [baseline, ...remainingPeriods] = periods;
    if (!baseline) return [];
    return baseline.metrics.dimensionAverages
      .filter(
        (dimension) =>
          dimension.average !== null &&
          dimension.denominator > 0 &&
          remainingPeriods.every((period) =>
            period.metrics.dimensionAverages.some(
              (candidate) =>
                candidate.code === dimension.code &&
                candidate.average !== null &&
                candidate.denominator > 0,
            ),
          ),
      )
      .map(({ code, title, order }) => ({ code, title, order }));
  }

  private base(
    query: ParticipationDashboardQueryDto,
    source: DataSource | EntityManager = this.dataSource,
  ) {
    const builder = source
      .getRepository(CampaignSchool)
      .createQueryBuilder('assignment')
      .innerJoin(School, 'school', 'school.id = assignment.schoolId')
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
      .where('assignment.campaignId = :campaignId', {
        campaignId: query.campaignId,
      })
      .andWhere('assignment.removedAt IS NULL');
    applyDashboardSchoolFilters(builder, query);
    return builder;
  }

  private criticalBase(query: CriticalAlertsDashboardQueryDto) {
    const builder = this.base(query)
      .innerJoin(
        'evaluation_dimension_results',
        'critical_dimension',
        'critical_dimension.result_id = evaluation.id',
      )
      .andWhere('evaluation.id IS NOT NULL')
      .andWhere('critical_dimension.is_critical = true');
    if (query.criticalAreas?.length)
      builder.andWhere(
        'critical_dimension.dimension_code IN (:...criticalAreas)',
        { criticalAreas: query.criticalAreas },
      );
    if (query.dimensionCode)
      builder.andWhere(
        'critical_dimension.dimension_code = :criticalDimensionCode',
        { criticalDimensionCode: query.dimensionCode },
      );
    return builder;
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

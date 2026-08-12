import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { ResultsDashboardService } from './results-dashboard.service';

describe('ResultsDashboardService', () => {
  const campaign = {
    id: 'campaign-id',
    name: 'Etapa anual',
    status: CampaignStatus.Active,
    startsAt: new Date('2026-01-01T03:00:00Z'),
    endsAt: new Date('2027-01-01T02:59:59Z'),
  } as Campaign;

  it('informa el denominador propio de cada promedio de dimensión', async () => {
    const builders = [
      builder({
        rawOne: {
          universeSchools: '10',
          submittedSchools: '5',
          schoolsWithResult: '4',
          generalAverage: '72.125',
          resultsWithoutStars: '0',
          stars1: '0',
          stars2: '0',
          stars3: '1',
          stars4: '2',
          stars5: '1',
        },
      }),
      builder({
        rawMany: [
          {
            code: 'compromiso_institucional',
            average: '80.456',
            denominator: '3',
          },
        ],
      }),
    ];
    const service = fixture(campaign, builders);

    const response = await service.metrics({ campaignId: campaign.id });

    expect(response.metrics.dimensionAverages[0]).toMatchObject({
      average: 80.46,
      denominator: 3,
    });
    expect(response.denominators.averages).toBe(4);
  });

  it('aplica filtros multiselección a métricas y promedios por dimensión', async () => {
    const builders = [
      builder({
        rawOne: {
          universeSchools: '0',
          submittedSchools: '0',
          schoolsWithResult: '0',
          generalAverage: null,
          resultsWithoutStars: '0',
          stars1: '0',
          stars2: '0',
          stars3: '0',
          stars4: '0',
          stars5: '0',
        },
      }),
      builder({ rawMany: [] }),
    ];
    const service = fixture(campaign, builders);

    await service.metrics({
      campaignId: campaign.id,
      departments: ['Capital', 'Lavalle'],
      stars: [2, 3],
      criticalAreas: ['salud_mental'],
    });

    for (const queryBuilder of builders) {
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'school.department IN (:...departments)',
        { departments: ['Capital', 'Lavalle'] },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'evaluation.stars IN (:...stars)',
        { stars: [2, 3] },
      );
      expect(
        queryBuilder.andWhere.mock.calls.some(([condition]) =>
          String(condition).includes('dashboard_critical_dimension'),
        ),
      ).toBe(true);
    }
  });

  it('consolida escuelas y dimensiones críticas respetando el filtro', async () => {
    const builders = [
      builder({ rawOne: { schoolsCount: '2', alertsCount: '3' } }),
      builder({ rawOne: { schoolsWithResult: '8' } }),
      builder({
        rawMany: [
          {
            code: 'salud_mental',
            title: 'Salud Mental y Bienestar Emocional',
            order: '5',
            schoolsCount: '2',
          },
        ],
      }),
      builder({
        rawMany: [
          {
            schoolId: 'school-1',
            cue: '123',
            schoolName: 'Escuela',
            department: 'Capital',
            locality: 'Ciudad',
            generalScore: '55.5',
            stars: '2',
            dimensions: [
              {
                code: 'salud_mental',
                title: 'Salud Mental y Bienestar Emocional',
                score: '20',
                threshold: '33',
                order: 5,
              },
            ],
          },
        ],
      }),
    ];
    const service = fixture(campaign, builders);

    const response = await service.criticalAlerts({
      campaignId: campaign.id,
      criticalAreas: ['salud_mental'],
      dimensionCode: 'salud_mental',
      page: 1,
      limit: 10,
    });

    expect(response.summary).toMatchObject({
      schoolsCount: 2,
      schoolsWithResult: 8,
      schoolsPercentage: 25,
      alertsCount: 3,
      affectedDimensionCount: 1,
    });
    expect(response.items[0]).toMatchObject({
      generalScore: 55.5,
      stars: 2,
      dimensions: [{ score: 20, threshold: 33 }],
    });
    for (const queryBuilder of [builders[0], builders[3]])
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'critical_dimension.dimension_code = :criticalDimensionCode',
        { criticalDimensionCode: 'salud_mental' },
      );
    expect(builders[2].andWhere).not.toHaveBeenCalledWith(
      'critical_dimension.dimension_code = :criticalDimensionCode',
      expect.anything(),
    );
    expect(
      builders[1].andWhere.mock.calls.some(([condition]) =>
        String(condition).includes('dashboard_critical_dimension'),
      ),
    ).toBe(false);
    for (const queryBuilder of [builders[0], builders[2], builders[3]])
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'critical_dimension.dimension_code IN (:...criticalAreas)',
        { criticalAreas: ['salud_mental'] },
      );
  });

  it('rechaza alertas de una etapa en borrador', async () => {
    const service = fixture({ ...campaign, status: CampaignStatus.Draft }, []);

    await expect(
      service.criticalAlerts({ campaignId: campaign.id, page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('compara etapas en el orden solicitado y conserva cada denominador', async () => {
    const firstCampaign = {
      ...campaign,
      id: 'campaign-first',
      surveyVersionId: 'survey-version-shared',
    };
    const secondCampaign = {
      ...campaign,
      id: 'campaign-second',
      name: 'Etapa siguiente',
      surveyVersionId: 'survey-version-shared',
    };
    const builders = [
      resultBuilder('60', '3', 'algorithm-v1', 'rules-v1'),
      builder({
        rawMany: [dimensionRow('salud_mental', 'Salud mental', '5', '45')],
      }),
      resultBuilder('75', '4', 'algorithm-v1', 'rules-v1'),
      builder({
        rawMany: [dimensionRow('salud_mental', 'Salud mental', '5', '70')],
      }),
    ];
    const service = fixture([secondCampaign, firstCampaign], builders);

    const response = await service.comparison({
      campaignIds: [firstCampaign.id, secondCampaign.id],
      schoolIds: ['school-id'],
    });

    expect(response.baselineCampaignId).toBe(firstCampaign.id);
    expect(response.periods.map((period) => period.campaign.id)).toEqual([
      firstCampaign.id,
      secondCampaign.id,
    ]);
    expect(response.periods[0]).toMatchObject({
      denominators: { universeSchools: 1, averages: 1 },
      metrics: { generalAverage: 60, schoolsWithResult: 1 },
    });
    expect(response.periods[1]).toMatchObject({
      denominators: { universeSchools: 1, averages: 1 },
      metrics: {
        generalAverage: 75,
        dimensionAverages: [{ code: 'salud_mental', average: 70 }],
      },
    });
    expect(response.radarComparison).toMatchObject({
      available: true,
      comparable: true,
      mode: 'comparable',
      reason: null,
      selectedSchoolId: 'school-id',
    });
    expect(response.commonDimensions).toEqual([
      { code: 'salud_mental', title: 'Salud mental', order: 5 },
    ]);
    expect(response.comparisonPolicy).toMatchObject({
      cohortMode: 'independent_campaign_universes',
      schoolProfileSource: 'current',
      filterScope: 'institutional_only',
      excludedOutcomeFilters: ['submissionStatuses', 'stars', 'criticalAreas'],
    });
    expect(
      (
        service as unknown as {
          dataSource: { transaction: jest.Mock };
        }
      ).dataSource.transaction,
    ).toHaveBeenCalledWith('REPEATABLE READ', expect.any(Function));
  });

  it('marca el radar como descriptivo si falta la versión del algoritmo', async () => {
    const campaigns = [
      { ...campaign, id: 'campaign-first', surveyVersionId: 'survey-v1' },
      { ...campaign, id: 'campaign-second', surveyVersionId: 'survey-v1' },
    ] as Campaign[];
    const service = fixture(campaigns, [
      resultBuilder('60', '3', null, 'rules-v1'),
      builder({ rawMany: [] }),
      resultBuilder('70', '4', null, 'rules-v1'),
      builder({ rawMany: [] }),
    ]);

    const response = await service.comparison({
      campaignIds: campaigns.map(({ id }) => id),
      schoolIds: ['school-id'],
    });

    expect(response.radarComparison).toMatchObject({
      available: true,
      comparable: false,
      mode: 'descriptive',
      reason: 'unknown_calculation_metadata',
    });
  });

  it('no altera la comparabilidad geométrica por una configuración de estrellas distinta', async () => {
    const campaigns = [
      { ...campaign, id: 'campaign-first', surveyVersionId: 'survey-v1' },
      { ...campaign, id: 'campaign-second', surveyVersionId: 'survey-v1' },
    ] as Campaign[];
    const service = fixture(campaigns, [
      resultBuilder('60', '3', 'algorithm-v1', 'star-rules-v1'),
      builder({ rawMany: [] }),
      resultBuilder('70', '4', 'algorithm-v1', 'star-rules-v2'),
      builder({ rawMany: [] }),
    ]);

    const response = await service.comparison({
      campaignIds: campaigns.map(({ id }) => id),
      schoolIds: ['school-id'],
    });

    expect(response.radarComparison).toMatchObject({
      comparable: true,
      mode: 'comparable',
      reason: null,
    });
  });

  it('marca como descriptivas las dimensiones de versiones de cuestionario distintas', async () => {
    const campaigns = [
      { ...campaign, id: 'campaign-first', surveyVersionId: 'survey-v1' },
      { ...campaign, id: 'campaign-second', surveyVersionId: 'survey-v2' },
    ] as Campaign[];
    const service = fixture(campaigns, [
      resultBuilder('60', '3', 'algorithm-v1', 'rules-v1'),
      builder({ rawMany: [] }),
      resultBuilder('70', '4', 'algorithm-v1', 'rules-v1'),
      builder({ rawMany: [] }),
    ]);

    const response = await service.comparison({
      campaignIds: campaigns.map(({ id }) => id),
      schoolIds: ['school-id'],
    });

    expect(response.radarComparison).toMatchObject({
      available: true,
      comparable: false,
      mode: 'descriptive',
      reason: 'different_survey_version',
    });
  });

  it('indica que el radar no está disponible si falta un resultado', async () => {
    const campaigns = [
      { ...campaign, id: 'campaign-first', surveyVersionId: 'survey-v1' },
      { ...campaign, id: 'campaign-second', surveyVersionId: 'survey-v1' },
    ] as Campaign[];
    const service = fixture(campaigns, [
      resultBuilder('60', '3', 'algorithm-v1', 'rules-v1'),
      builder({ rawMany: [] }),
      noResultBuilder(),
      builder({ rawMany: [] }),
    ]);

    const response = await service.comparison({
      campaignIds: campaigns.map(({ id }) => id),
      schoolIds: ['school-id'],
    });

    expect(response.radarComparison).toMatchObject({
      available: false,
      comparable: false,
      mode: 'unavailable',
      reason: 'missing_result',
    });
  });

  it('rechaza la comparación si alguna etapa no existe', async () => {
    const existing = {
      ...campaign,
      id: 'campaign-existing',
      surveyVersionId: 'survey-v1',
    };
    const service = fixture([existing], []);

    await expect(
      service.comparison({
        campaignIds: [existing.id, 'campaign-missing'],
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('no expone un radar territorial y rechaza etapas en borrador', async () => {
    const active = {
      ...campaign,
      id: 'campaign-active',
      surveyVersionId: 'survey-v1',
    };
    const closed = {
      ...campaign,
      id: 'campaign-closed',
      status: CampaignStatus.Closed,
      surveyVersionId: 'survey-v1',
    } as Campaign;
    const service = fixture(
      [active, closed],
      [
        resultBuilder('60', '3', 'algorithm-v1', 'rules-v1'),
        builder({
          rawMany: [dimensionRow('salud_mental', 'Salud mental', '5', '45')],
        }),
        resultBuilder('70', '4', 'algorithm-v1', 'rules-v1'),
        builder({
          rawMany: [dimensionRow('salud_mental', 'Salud mental', '5', '70')],
        }),
      ],
    );
    const aggregate = await service.comparison({
      campaignIds: [active.id, closed.id],
    });

    expect(aggregate.radarComparison).toMatchObject({
      available: false,
      mode: 'unavailable',
      reason: 'single_school_required',
    });
    expect(aggregate.periods[0].metrics.dimensionAverages).toEqual([]);

    const draftService = fixture(
      [{ ...active }, { ...closed, status: CampaignStatus.Draft }],
      [],
    );
    await expect(
      draftService.comparison({ campaignIds: [active.id, closed.id] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function fixture(
  campaign: Campaign | Campaign[],
  builders: Array<Record<string, jest.Mock>>,
) {
  const campaigns = Array.isArray(campaign) ? campaign : [campaign];
  let builderIndex = 0;
  const getRepository = jest.fn((entity: unknown) =>
    entity === Campaign
      ? {
          findOneBy: jest.fn().mockResolvedValue(campaigns[0]),
          find: jest.fn().mockResolvedValue(campaigns),
        }
      : {
          createQueryBuilder: jest.fn(() => builders[builderIndex++]),
        },
  );
  const comparisonManager = {
    getRepository,
    query: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    getRepository,
    transaction: jest.fn(
      (
        _isolation: string,
        callback: (manager: typeof comparisonManager) => Promise<unknown>,
      ) => callback(comparisonManager),
    ),
  };
  return new ResultsDashboardService(dataSource as unknown as DataSource);
}

function resultBuilder(
  generalAverage: string,
  stars: string,
  algorithmVersion: string | null,
  evaluationConfigurationVersion: string | null,
) {
  return builder({
    rawOne: {
      universeSchools: '1',
      submittedSchools: '1',
      schoolsWithResult: '1',
      generalAverage,
      resultsWithoutStars: '0',
      stars1: stars === '1' ? '1' : '0',
      stars2: stars === '2' ? '1' : '0',
      stars3: stars === '3' ? '1' : '0',
      stars4: stars === '4' ? '1' : '0',
      stars5: stars === '5' ? '1' : '0',
      algorithmVersion,
      evaluationConfigurationVersion,
      calculatedAt: '2026-08-11T12:00:00.000Z',
      calculationSource: 'submission_finalization',
    },
  });
}

function noResultBuilder() {
  return builder({
    rawOne: {
      universeSchools: '1',
      submittedSchools: '0',
      schoolsWithResult: '0',
      generalAverage: null,
      resultsWithoutStars: '0',
      stars1: '0',
      stars2: '0',
      stars3: '0',
      stars4: '0',
      stars5: '0',
      algorithmVersion: null,
      evaluationConfigurationVersion: null,
      calculatedAt: null,
      calculationSource: null,
    },
  });
}

function dimensionRow(
  code: string,
  title: string,
  order: string,
  average: string,
) {
  return { code, title, order, average, denominator: '1' };
}

function builder({
  rawOne,
  rawMany = [],
}: {
  rawOne?: Record<string, string | null | Date>;
  rawMany?: Array<Record<string, unknown>>;
}) {
  const queryBuilder: Record<string, jest.Mock> = {};
  for (const method of [
    'innerJoin',
    'leftJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'setParameter',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'addOrderBy',
    'limit',
    'offset',
  ])
    queryBuilder[method] = jest.fn(() => queryBuilder);
  queryBuilder.getRawOne = jest.fn().mockResolvedValue(rawOne);
  queryBuilder.getRawMany = jest.fn().mockResolvedValue(rawMany);
  return queryBuilder;
}

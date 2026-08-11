import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import { Campaign } from '../../campaigns/entities/campaign.entity';
import { ParticipationDashboardService } from './participation-dashboard.service';

describe('ParticipationDashboardService', () => {
  const campaign = {
    id: 'campaign-id',
    name: 'Campaña anual',
    status: CampaignStatus.Active,
    startsAt: new Date('2026-01-01T03:00:00Z'),
    endsAt: new Date('2027-01-01T02:59:59Z'),
  } as Campaign;
  let rawRow: Record<string, string>;
  let queryBuilder: Record<string, jest.Mock>;
  let campaignRepository: { findOneBy: jest.Mock };
  let dataSource: DataSource;
  let service: ParticipationDashboardService;

  beforeEach(() => {
    rawRow = {
      totalSchools: '10',
      notStarted: '4',
      draft: '2',
      submitted: '4',
    };
    queryBuilder = {};
    for (const method of [
      'innerJoin',
      'leftJoin',
      'select',
      'addSelect',
      'where',
      'setParameters',
      'andWhere',
    ])
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    queryBuilder.getRawOne = jest.fn().mockImplementation(() => rawRow);
    campaignRepository = { findOneBy: jest.fn().mockResolvedValue(campaign) };
    dataSource = {
      getRepository: jest.fn((entity) =>
        entity === Campaign
          ? campaignRepository
          : { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) },
      ),
    } as unknown as DataSource;
    service = new ParticipationDashboardService(dataSource);
  });

  it('calculates all participation indicators from one aggregate row', async () => {
    await expect(
      service.metrics({ campaignId: campaign.id }),
    ).resolves.toMatchObject({
      metrics: {
        totalSchools: 10,
        notStarted: 4,
        draft: 2,
        submitted: 4,
        participationPercentage: 40,
      },
    });
    expect(queryBuilder.getRawOne).toHaveBeenCalledTimes(1);
  });

  it('returns zero participation when the filtered total is zero', async () => {
    rawRow = { totalSchools: '0', notStarted: '0', draft: '0', submitted: '0' };
    const response = await service.metrics({ campaignId: campaign.id });
    expect(response.metrics.participationPercentage).toBe(0);
  });

  it.each([
    ['schoolIds', 'school.id'],
    ['departments', 'school.department'],
    ['localities', 'school.locality'],
    ['educationTypes', 'school.education_level'],
    ['managementTypes', 'school.management_type'],
    ['scopes', 'school.scope'],
    ['shifts', 'school.shift'],
  ] as const)(
    'applies the %s filter in PostgreSQL',
    async (property, column) => {
      await service.metrics({
        campaignId: campaign.id,
        [property]: ['first-value', 'second-value'],
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        `${column} IN (:...${property})`,
        { [property]: ['first-value', 'second-value'] },
      );
    },
  );

  it('filters structured education levels without multiplying metrics', async () => {
    await service.metrics({
      campaignId: campaign.id,
      educationLevels: ['primario', 'secundario'],
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('school_education_levels'),
      { educationLevels: ['primario', 'secundario'] },
    );
  });

  it('combines filters without changing the aggregate source', async () => {
    await service.metrics({
      campaignId: campaign.id,
      department: 'Capital',
      locality: 'Ciudad',
      shift: 'Completa',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'assignment.removedAt IS NULL',
    );
    expect(queryBuilder.getRawOne).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown campaign', async () => {
    campaignRepository.findOneBy.mockResolvedValue(null);
    await expect(
      service.metrics({ campaignId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects draft campaigns', async () => {
    campaignRepository.findOneBy.mockResolvedValue({
      ...campaign,
      status: CampaignStatus.Draft,
    });
    await expect(
      service.metrics({ campaignId: campaign.id }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('devuelve niveles estructurados y acota opciones por múltiples territorios', async () => {
    const campaignBuilder = optionsBuilder();
    campaignBuilder.getMany.mockResolvedValue([campaign]);
    const educationBuilder = optionsBuilder();
    educationBuilder.getRawMany.mockResolvedValue([
      { value: 'primario', label: 'Primario' },
      { value: 'secundario', label: 'Secundario' },
    ]);
    const attributesBuilder = optionsBuilder();
    attributesBuilder.getRawMany.mockResolvedValue([
      {
        educationLevel: 'Educación común',
        managementType: 'Estatal',
        scope: 'Urbano',
        shift: 'Simple',
      },
    ]);
    const schoolsBuilder = optionsBuilder();
    schoolsBuilder.getRawMany.mockResolvedValue([
      { id: 'school-1', cue: '50001', name: 'Escuela Uno' },
    ]);
    const schoolBuilder = optionsBuilder();
    schoolBuilder.clone
      .mockReturnValueOnce(educationBuilder)
      .mockReturnValueOnce(attributesBuilder)
      .mockReturnValueOnce(schoolsBuilder);
    const departmentsBuilder = optionsBuilder();
    departmentsBuilder.getRawMany.mockResolvedValue([
      { value: 'Capital' },
      { value: 'Lavalle' },
    ]);
    const localitiesBuilder = optionsBuilder();
    localitiesBuilder.getRawMany.mockResolvedValue([
      { value: 'Ciudad' },
      { value: 'Costa de Araujo' },
    ]);
    const assignmentRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(schoolBuilder)
        .mockReturnValueOnce(departmentsBuilder)
        .mockReturnValueOnce(localitiesBuilder),
    };
    const optionsDataSource = {
      getRepository: jest.fn((entity) =>
        entity === Campaign
          ? { createQueryBuilder: jest.fn(() => campaignBuilder) }
          : assignmentRepository,
      ),
    } as unknown as DataSource;
    const optionsService = new ParticipationDashboardService(optionsDataSource);

    const response = await optionsService.filterOptions({
      campaignId: campaign.id,
      departments: ['Capital', 'Lavalle'],
      localities: ['Ciudad', 'Costa de Araujo'],
    });

    expect(schoolBuilder.andWhere).toHaveBeenCalledWith(
      'school.department IN (:...departments)',
      { departments: ['Capital', 'Lavalle'] },
    );
    expect(schoolBuilder.andWhere).toHaveBeenCalledWith(
      'school.locality IN (:...localities)',
      { localities: ['Ciudad', 'Costa de Araujo'] },
    );
    expect(localitiesBuilder.andWhere).toHaveBeenCalledWith(
      'school.department IN (:...departments)',
      { departments: ['Capital', 'Lavalle'] },
    );
    expect(educationBuilder.distinct).toHaveBeenCalledWith(true);
    expect(educationBuilder.select).toHaveBeenCalledWith(
      'education_level_option.code',
      'value',
    );
    expect(response.educationLevelOptions).toEqual([
      { value: 'primario', label: 'Primario' },
      { value: 'secundario', label: 'Secundario' },
    ]);
    expect(response.educationLevels).toEqual(['Educación común']);
    expect(response.educationTypes).toEqual(['Educación común']);
    expect(response.criticalAreas).toHaveLength(6);
  });
});

function optionsBuilder() {
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'innerJoin',
    'leftJoin',
    'select',
    'addSelect',
    'distinct',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
  ])
    builder[method] = jest.fn(() => builder);
  builder.clone = jest.fn(() => builder);
  builder.getMany = jest.fn().mockResolvedValue([]);
  builder.getRawMany = jest.fn().mockResolvedValue([]);
  return builder;
}

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
    ['schoolId', 'school.id'],
    ['department', 'school.department'],
    ['locality', 'school.locality'],
    ['educationLevel', 'school.education_level'],
    ['managementType', 'school.management_type'],
    ['scope', 'school.scope'],
    ['shift', 'school.shift'],
  ] as const)(
    'applies the %s filter in PostgreSQL',
    async (property, column) => {
      await service.metrics({
        campaignId: campaign.id,
        [property]: 'selected-value',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        `${column} = :${property}`,
        { [property]: 'selected-value' },
      );
    },
  );

  it('combines filters without changing the aggregate source', async () => {
    await service.metrics({
      campaignId: campaign.id,
      department: 'Capital',
      locality: 'Ciudad',
      shift: 'Completa',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledTimes(3);
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
});

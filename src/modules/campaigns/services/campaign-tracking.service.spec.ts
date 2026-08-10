import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import {
  CampaignParticipationStatus,
  CampaignTrackingSort,
  ListCampaignTrackingQueryDto,
  SortDirection,
} from '../dto/list-campaign-tracking-query.dto';
import { CampaignStatus } from '../entities/campaign-status.enum';
import { CampaignType } from '../entities/campaign-type.enum';
import { Campaign } from '../entities/campaign.entity';
import { CampaignTrackingService } from './campaign-tracking.service';

describe('CampaignTrackingService', () => {
  const campaign = {
    id: 'campaign-id',
    name: 'Campaña 2026',
    type: CampaignType.Annual,
    status: CampaignStatus.Active,
    startsAt: new Date('2026-07-01T03:00:00.000Z'),
    endsAt: new Date('2026-08-01T02:59:59.999Z'),
    closedAt: null,
  } as Campaign;
  let campaignRepository: { findOneBy: jest.Mock };
  let schoolRepository: { createQueryBuilder: jest.Mock };
  let service: CampaignTrackingService;

  beforeEach(() => {
    campaignRepository = { findOneBy: jest.fn().mockResolvedValue(campaign) };
    schoolRepository = { createQueryBuilder: jest.fn() };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Campaign ? campaignRepository : schoolRepository,
      ),
    } as unknown as DataSource;
    service = new CampaignTrackingService(dataSource);
  });

  it('calculates exclusive state counts and submitted percentages', async () => {
    const builder = queryBuilder();
    builder.getRawOne.mockResolvedValue({
      total: '4',
      notStarted: '1',
      draft: '1',
      submitted: '2',
    });
    schoolRepository.createQueryBuilder.mockReturnValue(builder);

    await expect(service.summary(campaign.id)).resolves.toMatchObject({
      totalSchools: 4,
      submittedPercentage: 50,
      states: {
        not_started: { count: 1, percentage: 25 },
        draft: { count: 1, percentage: 25 },
        submitted: { count: 2, percentage: 50 },
      },
    });
    expect(builder.leftJoin).toHaveBeenCalledWith(
      expect.anything(),
      'submission',
      expect.stringContaining('submission.campaignId = :campaignId'),
      { campaignId: campaign.id },
    );
  });

  it('returns zero percentages for a campaign without included schools', async () => {
    const builder = queryBuilder();
    builder.getRawOne.mockResolvedValue({
      total: '0',
      notStarted: '0',
      draft: '0',
      submitted: '0',
    });
    schoolRepository.createQueryBuilder.mockReturnValue(builder);

    const summary = await service.summary(campaign.id);

    expect(summary.totalSchools).toBe(0);
    expect(summary.submittedPercentage).toBe(0);
    expect(
      Object.values(summary.states).every(
        ({ count, percentage }) => count === 0 && percentage === 0,
      ),
    ).toBe(true);
  });

  it('maps not-started, draft and submitted schools without hiding inactive history', async () => {
    const countBuilder = queryBuilder();
    const idsBuilder = queryBuilder();
    const dataBuilder = queryBuilder();
    countBuilder.getCount.mockResolvedValue(3);
    idsBuilder.getRawMany.mockResolvedValue([
      { schoolId: 'school-not-started' },
      { schoolId: 'school-draft' },
      { schoolId: 'school-submitted' },
    ]);
    dataBuilder.getRawMany.mockResolvedValue([
      trackingRow({
        schoolId: 'school-not-started',
        submissionId: null,
        submissionStatus: null,
        schoolIsActive: false,
      }),
      trackingRow({
        schoolId: 'school-draft',
        submissionId: 'submission-draft',
        submissionStatus: SubmissionStatus.Draft,
        schoolIsActive: true,
        respondentIsActive: false,
        answeredCount: '3',
        applicableCount: '6',
      }),
      trackingRow({
        schoolId: 'school-submitted',
        submissionId: 'submission-submitted',
        submissionStatus: SubmissionStatus.Submitted,
        submittedAt: '2026-07-20T15:00:00.000Z',
        answeredCount: '6',
        applicableCount: '6',
      }),
    ]);
    schoolRepository.createQueryBuilder
      .mockReturnValueOnce(countBuilder)
      .mockReturnValueOnce(idsBuilder)
      .mockReturnValueOnce(dataBuilder);

    const response = await service.list(
      campaign.id,
      new ListCampaignTrackingQueryDto(),
    );

    expect(response.items.map(({ status }) => status)).toEqual([
      CampaignParticipationStatus.NotStarted,
      CampaignParticipationStatus.Draft,
      CampaignParticipationStatus.Submitted,
    ]);
    expect(response.items[0]).toMatchObject({
      school: { isActive: false },
      progress: { percentage: 0 },
      originalRespondent: null,
    });
    expect(response.items[1]).toMatchObject({
      progress: { answered: 3, applicable: 6, percentage: 50 },
      originalRespondent: {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@example.com',
        isActive: false,
      },
    });
    expect(response.items[2]).toMatchObject({
      progress: { percentage: 100 },
      submission: { submittedAt: '2026-07-20T15:00:00.000Z' },
    });
  });

  it('applies status, CUE/name search, pagination and ordering in backend', async () => {
    const countBuilder = queryBuilder();
    const idsBuilder = queryBuilder();
    countBuilder.getCount.mockResolvedValue(0);
    idsBuilder.getRawMany.mockResolvedValue([]);
    schoolRepository.createQueryBuilder
      .mockReturnValueOnce(countBuilder)
      .mockReturnValueOnce(idsBuilder);
    const query = Object.assign(new ListCampaignTrackingQueryDto(), {
      search: '50001',
      status: CampaignParticipationStatus.Draft,
      sortBy: CampaignTrackingSort.LastSavedAt,
      sortDirection: SortDirection.Desc,
      page: 2,
      limit: 10,
    });

    await service.list(campaign.id, query);

    expect(countBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(school.cue)'),
      { search: '%50001%' },
    );
    expect(countBuilder.andWhere).toHaveBeenCalledWith(
      'submission.status = :trackingStatus',
      { trackingStatus: SubmissionStatus.Draft },
    );
    expect(idsBuilder.offset).toHaveBeenCalledWith(10);
    expect(idsBuilder.limit).toHaveBeenCalledWith(10);
    expect(idsBuilder.orderBy).toHaveBeenCalledWith(
      'submission.lastSavedAt',
      'DESC',
      'NULLS LAST',
    );
  });

  it('uses the earlier manual close as the historical inclusion cutoff', async () => {
    const manuallyClosed = {
      ...campaign,
      status: CampaignStatus.Closed,
      closedAt: new Date('2026-07-15T18:00:00.000Z'),
    } as Campaign;
    campaignRepository.findOneBy.mockResolvedValue(manuallyClosed);
    const builder = queryBuilder();
    builder.getRawOne.mockResolvedValue({
      total: '0',
      notStarted: '0',
      draft: '0',
      submitted: '0',
    });
    schoolRepository.createQueryBuilder.mockReturnValue(builder);

    const summary = await service.summary(campaign.id);

    expect(summary.campaign.inclusionCutoff).toBe('2026-07-15T18:00:00.000Z');
    expect(builder.where).toHaveBeenCalledWith(
      'assignment.campaignId = :campaignId',
      { campaignId: campaign.id },
    );
  });

  it('marks an incomplete historical respondent without dropping the sent row', async () => {
    const countBuilder = queryBuilder();
    const idsBuilder = queryBuilder();
    const dataBuilder = queryBuilder();
    countBuilder.getCount.mockResolvedValue(1);
    idsBuilder.getRawMany.mockResolvedValue([{ schoolId: 'school-id' }]);
    dataBuilder.getRawMany.mockResolvedValue([
      trackingRow({
        submissionId: 'submission-id',
        submissionStatus: SubmissionStatus.Submitted,
        submittedAt: '2026-07-20T15:00:00.000Z',
        originalRespondentSnapshot: {},
        respondentFirstName: null,
        respondentLastName: null,
        respondentEmail: null,
      }),
    ]);
    schoolRepository.createQueryBuilder
      .mockReturnValueOnce(countBuilder)
      .mockReturnValueOnce(idsBuilder)
      .mockReturnValueOnce(dataBuilder);

    const response = await service.list(
      campaign.id,
      new ListCampaignTrackingQueryDto(),
    );

    expect(response.items[0]).toMatchObject({
      status: CampaignParticipationStatus.Submitted,
      originalRespondent: null,
      historicalDataComplete: false,
    });
  });

  it('rejects an unknown campaign', async () => {
    campaignRepository.findOneBy.mockResolvedValue(null);

    await expect(service.summary('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(schoolRepository.createQueryBuilder).not.toHaveBeenCalled();
  });
});

function queryBuilder() {
  const builder = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    getCount: jest.fn(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
  };
  for (const method of [
    'innerJoin',
    'leftJoin',
    'where',
    'andWhere',
    'select',
    'addSelect',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'limit',
    'offset',
  ] as const) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

function trackingRow(overrides: Partial<ReturnType<typeof baseTrackingRow>>) {
  return { ...baseTrackingRow(), ...overrides };
}

function baseTrackingRow() {
  return {
    schoolId: 'school-id',
    schoolCue: '500012300',
    schoolName: 'Escuela Uno',
    schoolIsActive: true,
    submissionId: null as string | null,
    submissionStatus: null as SubmissionStatus | null,
    startedAt: '2026-07-10T12:00:00.000Z',
    lastSavedAt: '2026-07-11T12:00:00.000Z',
    submittedAt: null as string | null,
    originalRespondentId: 'user-id',
    originalRespondentSnapshot: {
      id: 'user-id',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@example.com',
    },
    respondentFirstName: 'Ana' as string | null,
    respondentLastName: 'Pérez' as string | null,
    respondentEmail: 'ana@example.com' as string | null,
    respondentIsActive: true as boolean | null,
    answeredCount: '0',
    applicableCount: '0',
  };
}

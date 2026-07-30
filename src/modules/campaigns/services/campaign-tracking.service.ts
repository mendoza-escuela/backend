import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { School } from '../../schools/entities/school.entity';
import { SurveySubmission } from '../../submissions/entities/survey-submission.entity';
import { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import { User } from '../../users/entities/user.entity';
import type {
  CampaignTrackingListDto,
  CampaignTrackingSchoolDto,
  CampaignTrackingSummaryDto,
} from '../dto/campaign-tracking-response.dto';
import {
  CampaignParticipationStatus,
  CampaignTrackingSort,
  ListCampaignTrackingQueryDto,
  SortDirection,
} from '../dto/list-campaign-tracking-query.dto';
import { Campaign } from '../entities/campaign.entity';

type TrackingCountRow = {
  total: string;
  notStarted: string;
  draft: string;
  submitted: string;
};

type TrackingSchoolRow = {
  schoolId: string;
  schoolCue: string;
  schoolName: string;
  schoolIsActive: boolean;
  submissionId: string | null;
  submissionStatus: SubmissionStatus | null;
  startedAt: Date | string | null;
  lastSavedAt: Date | string | null;
  submittedAt: Date | string | null;
  originalRespondentId: string | null;
  originalRespondentSnapshot: unknown;
  respondentFirstName: string | null;
  respondentLastName: string | null;
  respondentEmail: string | null;
  respondentIsActive: boolean | null;
  answeredCount: string;
  applicableCount: string;
};

type RespondentSnapshot = {
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
};

@Injectable()
export class CampaignTrackingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Resume el padrón abierto de la campaña con tres estados excluyentes.
   *
   * El porcentaje general representa escuelas enviadas sobre el universo
   * incluido. Los borradores no reciben una ponderación parcial.
   */
  async summary(campaignId: string): Promise<CampaignTrackingSummaryDto> {
    const campaign = await this.campaign(campaignId);
    const inclusionCutoff = this.inclusionCutoff(campaign);
    const counts = await this.baseQuery(campaignId, inclusionCutoff)
      .select('COUNT("school"."id")', 'total')
      .addSelect(
        'COUNT("school"."id") FILTER (WHERE "submission"."id" IS NULL)',
        'notStarted',
      )
      .addSelect(
        `COUNT("school"."id") FILTER (WHERE "submission"."status" = '${SubmissionStatus.Draft}')`,
        'draft',
      )
      .addSelect(
        `COUNT("school"."id") FILTER (WHERE "submission"."status" = '${SubmissionStatus.Submitted}')`,
        'submitted',
      )
      .getRawOne<TrackingCountRow>();
    const total = this.count(counts?.total);
    const notStarted = this.count(counts?.notStarted);
    const draft = this.count(counts?.draft);
    const submitted = this.count(counts?.submitted);

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt.toISOString(),
        inclusionCutoff: inclusionCutoff.toISOString(),
      },
      totalSchools: total,
      submittedPercentage: this.percentage(submitted, total),
      states: {
        [CampaignParticipationStatus.NotStarted]: {
          count: notStarted,
          percentage: this.percentage(notStarted, total),
        },
        [CampaignParticipationStatus.Draft]: {
          count: draft,
          percentage: this.percentage(draft, total),
        },
        [CampaignParticipationStatus.Submitted]: {
          count: submitted,
          percentage: this.percentage(submitted, total),
        },
      },
    };
  }

  /**
   * Pagina y filtra completamente en PostgreSQL. Los datos del usuario
   * original se toman primero del snapshot inmutable de la presentación.
   */
  async list(
    campaignId: string,
    query: ListCampaignTrackingQueryDto,
  ): Promise<CampaignTrackingListDto> {
    const campaign = await this.campaign(campaignId);
    const inclusionCutoff = this.inclusionCutoff(campaign);
    const countBuilder = this.filteredQuery(
      this.baseQuery(campaignId, inclusionCutoff),
      query,
    );
    const total = await countBuilder.getCount();
    const builder = this.filteredQuery(
      this.baseQuery(campaignId, inclusionCutoff),
      query,
    )
      .select('school.id', 'schoolId')
      .addSelect('school.cue', 'schoolCue')
      .addSelect('school.name', 'schoolName')
      .addSelect('school.isActive', 'schoolIsActive')
      .addSelect('submission.id', 'submissionId')
      .addSelect('submission.status', 'submissionStatus')
      .addSelect('submission.startedAt', 'startedAt')
      .addSelect('submission.lastSavedAt', 'lastSavedAt')
      .addSelect('submission.submittedAt', 'submittedAt')
      .addSelect('submission.originalRespondentId', 'originalRespondentId')
      .addSelect(
        'submission.originalRespondentSnapshot',
        'originalRespondentSnapshot',
      )
      .addSelect('respondent.firstName', 'respondentFirstName')
      .addSelect('respondent.lastName', 'respondentLastName')
      .addSelect('respondent.email', 'respondentEmail')
      .addSelect('respondent.isActive', 'respondentIsActive')
      .addSelect(
        `(SELECT COUNT(*) FROM "survey_answers" "answer"
          WHERE "answer"."submission_id" = "submission"."id")`,
        'answeredCount',
      )
      .addSelect(
        `(SELECT COUNT(*) FROM "submission_question_applicability" "decision"
          WHERE "decision"."submission_id" = "submission"."id"
            AND "decision"."status" = 'applicable')`,
        'applicableCount',
      )
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    this.applyOrdering(builder, query);
    const rows = await builder.getRawMany<TrackingSchoolRow>();

    return {
      items: rows.map((row) => this.trackingSchool(row)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  private async campaign(id: string): Promise<Campaign> {
    const campaign = await this.dataSource
      .getRepository(Campaign)
      .findOneBy({ id });
    if (!campaign) throw new NotFoundException('La campaña no existe.');
    return campaign;
  }

  private baseQuery(
    campaignId: string,
    inclusionCutoff: Date,
  ): SelectQueryBuilder<School> {
    return this.dataSource
      .getRepository(School)
      .createQueryBuilder('school')
      .leftJoin(
        SurveySubmission,
        'submission',
        'submission.schoolId = school.id AND submission.campaignId = :campaignId',
        { campaignId },
      )
      .leftJoin(
        User,
        'respondent',
        'respondent.id = submission.originalRespondentId',
      )
      .where(
        '(school.createdAt <= :inclusionCutoff OR submission.id IS NOT NULL)',
        { inclusionCutoff },
      );
  }

  private filteredQuery(
    builder: SelectQueryBuilder<School>,
    query: ListCampaignTrackingQueryDto,
  ): SelectQueryBuilder<School> {
    if (query.search) {
      builder.andWhere(
        '(LOWER(school.cue) LIKE :search OR LOWER(school.name) LIKE :search)',
        { search: `%${query.search.toLowerCase()}%` },
      );
    }
    if (query.status === CampaignParticipationStatus.NotStarted) {
      builder.andWhere('submission.id IS NULL');
    } else if (query.status === CampaignParticipationStatus.Draft) {
      builder.andWhere('submission.status = :trackingStatus', {
        trackingStatus: SubmissionStatus.Draft,
      });
    } else if (query.status === CampaignParticipationStatus.Submitted) {
      builder.andWhere('submission.status = :trackingStatus', {
        trackingStatus: SubmissionStatus.Submitted,
      });
    }
    return builder;
  }

  private applyOrdering(
    builder: SelectQueryBuilder<School>,
    query: ListCampaignTrackingQueryDto,
  ): void {
    const direction =
      query.sortDirection === SortDirection.Desc ? 'DESC' : 'ASC';
    if (query.sortBy === CampaignTrackingSort.Status) {
      builder.orderBy(
        `CASE
          WHEN submission.id IS NULL THEN 0
          WHEN submission.status = '${SubmissionStatus.Draft}' THEN 1
          ELSE 2
        END`,
        direction,
      );
    } else if (query.sortBy === CampaignTrackingSort.LastSavedAt) {
      builder.orderBy('submission.lastSavedAt', direction, 'NULLS LAST');
    } else if (query.sortBy === CampaignTrackingSort.SubmittedAt) {
      builder.orderBy('submission.submittedAt', direction, 'NULLS LAST');
    } else {
      builder.orderBy('LOWER(school.name)', direction);
    }
    builder
      .addOrderBy('LOWER(school.name)', 'ASC')
      .addOrderBy('school.cue', 'ASC');
  }

  private trackingSchool(row: TrackingSchoolRow): CampaignTrackingSchoolDto {
    const status = this.participationStatus(row);
    const answered = this.count(row.answeredCount);
    const applicable = this.count(row.applicableCount);
    const respondent = this.originalRespondent(row);
    const submittedAt = this.isoDate(row.submittedAt);
    const startedAt = this.isoDate(row.startedAt);
    const historicalDataComplete =
      status === CampaignParticipationStatus.NotStarted ||
      (Boolean(startedAt) &&
        respondent.historicalDataComplete &&
        (status !== CampaignParticipationStatus.Submitted ||
          Boolean(submittedAt)));

    return {
      school: {
        id: row.schoolId,
        cue: row.schoolCue,
        name: row.schoolName,
        isActive: row.schoolIsActive,
      },
      status,
      progress: {
        answered,
        applicable,
        percentage:
          status === CampaignParticipationStatus.Submitted
            ? 100
            : this.percentage(answered, applicable),
      },
      submission: row.submissionId
        ? {
            id: row.submissionId,
            startedAt,
            lastSavedAt: this.isoDate(row.lastSavedAt),
            submittedAt,
          }
        : null,
      originalRespondent: respondent.value,
      historicalDataComplete,
    };
  }

  private originalRespondent(row: TrackingSchoolRow): {
    value: CampaignTrackingSchoolDto['originalRespondent'];
    historicalDataComplete: boolean;
  } {
    if (!row.submissionId) {
      return { value: null, historicalDataComplete: true };
    }
    const snapshot = this.respondentSnapshot(row.originalRespondentSnapshot);
    const firstName =
      this.nonEmptyText(snapshot?.firstName) ?? row.respondentFirstName;
    const lastName =
      this.nonEmptyText(snapshot?.lastName) ?? row.respondentLastName;
    const email = this.nonEmptyText(snapshot?.email) ?? row.respondentEmail;
    const snapshotComplete = Boolean(
      this.nonEmptyText(snapshot?.firstName) &&
      this.nonEmptyText(snapshot?.lastName) &&
      this.nonEmptyText(snapshot?.email),
    );
    if (!firstName || !lastName || !email) {
      return { value: null, historicalDataComplete: false };
    }
    return {
      value: {
        id: this.nonEmptyText(snapshot?.id) ?? row.originalRespondentId ?? null,
        firstName,
        lastName,
        email,
        isActive: row.respondentIsActive,
        historicalDataComplete: snapshotComplete,
      },
      historicalDataComplete: snapshotComplete,
    };
  }

  private respondentSnapshot(value: unknown): RespondentSnapshot | null {
    if (typeof value === 'string') {
      try {
        return this.respondentSnapshot(JSON.parse(value) as unknown);
      } catch {
        return null;
      }
    }
    return value && typeof value === 'object' ? value : null;
  }

  private participationStatus(
    row: TrackingSchoolRow,
  ): CampaignParticipationStatus {
    if (!row.submissionId) return CampaignParticipationStatus.NotStarted;
    return row.submissionStatus === SubmissionStatus.Submitted
      ? CampaignParticipationStatus.Submitted
      : CampaignParticipationStatus.Draft;
  }

  private inclusionCutoff(campaign: Campaign): Date {
    return campaign.closedAt && campaign.closedAt < campaign.endsAt
      ? campaign.closedAt
      : campaign.endsAt;
  }

  private percentage(value: number, total: number): number {
    return total > 0 ? Number(((value * 100) / total).toFixed(2)) : 0;
  }

  private count(value: string | undefined): number {
    const count = Number(value ?? 0);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

  private nonEmptyText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private isoDate(value: Date | string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}

import type { CampaignStatus } from '../entities/campaign-status.enum';
import type { CampaignType } from '../entities/campaign-type.enum';
import type { CampaignParticipationStatus } from './list-campaign-tracking-query.dto';

type CampaignTrackingStatusSummaryDto = {
  count: number;
  percentage: number;
};

export type CampaignTrackingSummaryDto = {
  campaign: {
    id: string;
    name: string;
    type: CampaignType;
    status: CampaignStatus;
    startsAt: string;
    endsAt: string;
    inclusionCutoff: string;
  };
  totalSchools: number;
  submittedPercentage: number;
  states: Record<CampaignParticipationStatus, CampaignTrackingStatusSummaryDto>;
};

export type CampaignTrackingSchoolDto = {
  school: {
    id: string;
    cue: string;
    name: string;
    isActive: boolean;
  };
  status: CampaignParticipationStatus;
  progress: {
    answered: number;
    applicable: number;
    percentage: number;
  };
  submission: {
    id: string;
    startedAt: string | null;
    lastSavedAt: string | null;
    submittedAt: string | null;
  } | null;
  originalRespondent: {
    id: string | null;
    firstName: string;
    lastName: string;
    email: string;
    isActive: boolean | null;
    historicalDataComplete: boolean;
  } | null;
  historicalDataComplete: boolean;
};

export type CampaignTrackingListDto = {
  items: CampaignTrackingSchoolDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

import type { CampaignStatus } from '../../campaigns/entities/campaign-status.enum';
import type { CampaignType } from '../../campaigns/entities/campaign-type.enum';
import type { SchoolRectificationSnapshot } from '../../schools/entities/school-rectification.entity';
import type { SurveyAnswerValue } from '../../submissions/entities/survey-answer.entity';
import type { SubmissionStatus } from '../../submissions/entities/submission-status.enum';
import type { EvaluationRuleSnapshot } from '../evaluation-snapshot.type';

export type AdminSchoolResultDetailDto = {
  campaign: {
    id: string;
    name: string;
    type: CampaignType;
    status: CampaignStatus;
    startsAt: string;
    endsAt: string;
  };
  school: {
    id: string;
    cue: string;
    name: string;
    schoolNumber: string | null;
    department: string;
    locality: string;
    managementType: string;
    scope: string;
    educationLevel: string;
    isActive: boolean;
  };
  participationStatus: 'not_started' | 'draft' | 'submitted';
  submission: null | {
    id: string;
    status: SubmissionStatus;
    startedAt: string | null;
    lastSavedAt: string | null;
    submittedAt: string | null;
    originalRespondent: {
      id: string | null;
      firstName: string;
      lastName: string;
      email: string;
      isActive: boolean | null;
    };
  };
  historicalSchoolProfile: SchoolRectificationSnapshot | null;
  result: AdminSchoolPersistedResultDto | null;
  history: AdminSchoolResultHistoryEntryDto[];
  dataQuality: {
    historicalProfileAvailable: boolean;
    resultSnapshotAvailable: boolean;
  };
};

export type AdminSchoolPersistedResultDto = {
  id: string;
  generalScore: number | null;
  numerator: number | null;
  denominator: number | null;
  stars: {
    base: number | null;
    final: number | null;
    blockingReasons: string[];
    configurationVersion: string | null;
  };
  alerts: Array<Record<string, unknown>>;
  dimensions: Array<{
    id: string;
    code: string;
    title: string;
    order: number;
    score: number | null;
    available: boolean;
    isCritical: boolean;
    criticalValue: number | null;
    criticalThreshold: number | null;
  }>;
  answers: Array<{
    id: string;
    code: string;
    prompt: string;
    required: boolean;
    order: number;
    dimension: { code: string; title: string };
    section: { code: string; title: string };
    applicability: string;
    answer: {
      value: SurveyAnswerValue;
      optionLabel: string | null;
      scoreUsed: number | null;
    };
  }>;
  excludedQuestions: Array<{
    id: string;
    code: string;
    prompt: string;
    required: boolean;
    order: number;
    dimension: { code: string; title: string };
    section: { code: string; title: string };
    exclusion: {
      reasonCode: string;
      reason: string;
      relevantSchoolFacts: Record<string, unknown>;
      rules: EvaluationRuleSnapshot[];
    };
  }>;
  survey: null | {
    id: string;
    code: string;
    name: string;
    version: {
      id: string;
      number: number;
      title: string;
      instructions: string | null;
      publishedAt: string;
    };
  };
  calculation: {
    calculatedAt: string;
    algorithmVersion: string;
    snapshotSchemaVersion: number;
    source: string;
    calculatedBy: null | { id: string; firstName: string; lastName: string };
  };
};

export type AdminSchoolResultHistoryEntryDto = {
  type: string;
  label: string;
  at: string;
};

import type { EvaluationSnapshot } from '../evaluation/evaluation-snapshot.type';

export type ReportBranding = {
  programName: string;
  organizations: string;
  logos: string[];
  signer: string | null;
  signerPosition: string | null;
  signatureImage: string | null;
  legalText: string | null;
  verificationUrl: string | null;
};

export type IndividualReportViewModel = {
  school: EvaluationSnapshot['school'] & {
    department?: string;
    managementType?: string;
  };
  campaign: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
  };
  survey: EvaluationSnapshot['survey'];
  submission: EvaluationSnapshot['submission'];
  result: EvaluationSnapshot['result'];
  algorithm: EvaluationSnapshot['algorithm'];
  branding: ReportBranding;
  radarSvg: string;
};

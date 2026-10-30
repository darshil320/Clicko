import {
  APPLICATION_BOARD_STAGES,
  APPLICATION_DECISION_STAGES,
  type ApplicationSource,
  type ApplicationStage,
  canMoveApplication,
  type DocumentKind,
  type DocumentReviewStatus,
  type PhotographerStatus,
  type PhotographerStatusAction,
} from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';

/** Supply words for people (ADR-0026 D8). */

export const STAGE_LABEL: Readonly<Record<ApplicationStage, string>> = {
  APPLIED: 'New',
  SCREENING: 'Screening',
  INTERVIEW_SCHEDULED: 'Interview booked',
  INTERVIEW_DONE: 'Interviewed',
  DOCS_REQUESTED: 'Documents asked',
  DOCS_UNDER_REVIEW: 'Checking documents',
  TRIAL_ASSIGNED: 'Trial shoot',
  TRIAL_REVIEW: 'Reviewing trial',
  CONTRACT_SENT: 'Contract sent',
  APPROVED: 'Onboarded',
  REJECTED: 'Not a fit',
  ON_HOLD: 'On hold',
  WITHDRAWN: 'Withdrew',
};

export const SOURCE_LABEL: Readonly<Record<ApplicationSource, string>> = {
  REFERRAL: 'Referral',
  INSTAGRAM: 'Instagram',
  WALK_IN: 'Walk-in',
  OUTREACH: 'Our outreach',
  OTHER: 'Other',
};

export const DOC_LABEL: Readonly<Record<DocumentKind, string>> = {
  PAN_CARD: 'PAN card',
  DRIVING_LICENCE: 'Driving licence',
  PASSPORT: 'Passport',
  VOTER_ID: 'Voter ID',
  ADDRESS_PROOF: 'Address proof',
  POLICE_VERIFICATION: 'Police verification',
  BANK_PROOF: 'Bank proof',
  GST_CERTIFICATE: 'GST certificate',
  DRONE_RPC: 'Drone pilot certificate',
  DRONE_UIN: 'Drone registration',
  EQUIPMENT_INVOICE: 'Equipment invoice',
  SIGNED_CONTRACT: 'Signed contract',
  OTHER: 'Other document',
};

export const DOC_STATUS: Readonly<
  Record<DocumentReviewStatus, { label: string; tone: BadgeVariant }>
> = {
  PENDING: { label: 'To check', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'destructive' },
  RESUBMIT_REQUESTED: { label: 'New copy asked', tone: 'warning' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

export const PRO_STATUS: Readonly<
  Record<PhotographerStatus, { label: string; tone: BadgeVariant }>
> = {
  APPLICANT: { label: 'Applicant', tone: 'neutral' },
  ACTIVE: { label: 'Active', tone: 'success' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  SUSPENDED: { label: 'Suspended', tone: 'destructive' },
  OFFBOARDED: { label: 'Offboarded', tone: 'neutral' },
};

export const ACTION_LABEL: Readonly<Record<PhotographerStatusAction, string>> = {
  PAUSE: 'Pause',
  REACTIVATE: 'Reactivate',
  SUSPEND: 'Suspend',
  OFFBOARD: 'Offboard',
};

export const PENALTY_LABEL: Readonly<Record<string, string>> = {
  NO_SHOW: 'No-show',
  LATE_UPLOAD: 'Late upload',
  SLA_BREACH: 'Late delivery',
  CONDUCT: 'Conduct',
  DATA_LOSS: 'Data loss',
};

export const SEVERITY_LABEL: Readonly<Record<number, string>> = {
  1: 'Warning',
  2: 'Deactivation',
  3: 'Removal',
};

/** What a status change does, in plain words (the confirm dialog). */
export function statusConsequence(action: PhotographerStatusAction, name: string): string {
  switch (action) {
    case 'PAUSE':
      return `${name} stops getting new shoot offers. Shoots already assigned stay with them.`;
    case 'REACTIVATE':
      return `${name} starts getting shoot offers again.`;
    case 'SUSPEND':
      return `${name} stops getting offers until a city manager reactivates them. Shoots already assigned stay with them — reassign them if needed.`;
    case 'OFFBOARD':
      return `${name} leaves Clickco for good and never gets an offer again. This cannot be undone.`;
  }
}

/** What approving a document does to the photographer's checks. */
export function documentConsequence(kind: DocumentKind, name: string): string {
  switch (kind) {
    case 'PAN_CARD':
      return `${name}'s PAN is marked verified.`;
    case 'BANK_PROOF':
      return `${name}'s bank account is marked verified.`;
    case 'POLICE_VERIFICATION':
      return `${name}'s police verification is recorded, with its expiry date.`;
    case 'DRIVING_LICENCE':
    case 'PASSPORT':
    case 'VOTER_ID':
      return `${name}'s identity is confirmed with this document (last four characters only).`;
    default:
      return 'The document is kept on file.';
  }
}

/** Where a card may go from `stage` for this person (decisions need a city manager). */
export function moveTargets(stage: ApplicationStage, canDecide: boolean): ApplicationStage[] {
  const all: readonly ApplicationStage[] = [
    ...APPLICATION_BOARD_STAGES,
    'APPROVED',
    'REJECTED',
    'WITHDRAWN',
  ];
  return all.filter(
    (to) =>
      canMoveApplication(stage, to) &&
      (canDecide || !(APPLICATION_DECISION_STAGES as readonly ApplicationStage[]).includes(to)),
  );
}

export const supplyKeys = {
  all: ['supply'] as const,
  board: (q: { cityId?: string; q?: string }) => ['supply', 'board', q] as const,
  application: (id: string) => ['supply', 'application', id] as const,
  kyc: ['supply', 'kyc'] as const,
  directory: (q: { q?: string; status?: string }) => ['supply', 'directory', q] as const,
  profile: (id: string) => ['supply', 'profile', id] as const,
};

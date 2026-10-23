/** v0.2 §9 / ADR-0013 D11 — the no-show ladder as a pure step function. */
import { ONSITE_CONFIG } from '../onsite.config';

const MIN = 60_000;
const plus = (d: Date, minutes: number): Date => new Date(d.getTime() + minutes * MIN);
const latest = (a: Date, b: Date): Date => (a > b ? a : b);

/** start + 15 min; a replacement accepted late also gets 90 min of travel from acceptance. */
export function noShowFirstCheckAt(a: {
  readonly scheduledStart: Date;
  readonly acceptedAt: Date;
  readonly isReplacement: boolean;
}): Date {
  const { alertAfterMinutes, replacementTravelMinutes } = ONSITE_CONFIG.noShow;
  const onTime = plus(a.scheduledStart, alertAfterMinutes);
  return a.isReplacement ? latest(onTime, plus(a.acceptedAt, replacementTravelMinutes)) : onTime;
}

export type NoShowStep =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'WAIT'; readonly until: Date }
  | { readonly kind: 'ALERT'; readonly escalateAt: Date }
  | { readonly kind: 'ESCALATE' };

export interface NoShowState {
  readonly now: Date;
  readonly scheduledStart: Date;
  readonly firstCheckAt: Date;
  /** When the NO_SHOW_SUSPECTED alert was recorded; null = not yet. */
  readonly alertedAt: Date | null;
  readonly checkedIn: boolean;
  /** The assignment still holds the booking (ASSIGNED / EN_ROUTE). */
  readonly active: boolean;
}

/** Escalation never comes sooner than 5 min after the alert, nor before start + 20 min. */
function escalateAt(s: NoShowState, alertedAt: Date): Date {
  const { escalateAfterMinutes, escalateAfterAlertMinutes } = ONSITE_CONFIG.noShow;
  return latest(
    plus(s.scheduledStart, escalateAfterMinutes),
    plus(alertedAt, escalateAfterAlertMinutes),
  );
}

export function noShowStep(s: NoShowState): NoShowStep {
  if (s.checkedIn || !s.active) return { kind: 'NONE' };
  if (s.alertedAt === null) {
    if (s.now < s.firstCheckAt) return { kind: 'WAIT', until: s.firstCheckAt };
    return { kind: 'ALERT', escalateAt: escalateAt(s, s.now) };
  }
  const due = escalateAt(s, s.alertedAt);
  return s.now < due ? { kind: 'WAIT', until: due } : { kind: 'ESCALATE' };
}

/** T&C §3.6b: minutes late when a replacement checks in after start + 15 min; else null. */
export function isLateReplacement(a: {
  readonly isReplacement: boolean;
  readonly checkInAt: Date;
  readonly scheduledStart: Date;
}): number | null {
  if (!a.isReplacement) return null;
  const lateBy = Math.floor((a.checkInAt.getTime() - a.scheduledStart.getTime()) / MIN);
  return lateBy > ONSITE_CONFIG.lateReplacementGraceMinutes ? lateBy : null;
}

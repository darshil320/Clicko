/**
 * What other modules may know about SLA breaches (ADR-0026 D2): the record shape, the "still
 * owed" rule and the payout deductions. Import these from here, never from the repository.
 */
export {
  type BreachAttribution,
  type BreachRecord,
  isOwed,
  OWED_ATTRIBUTIONS,
} from './repositories/sla-breaches.repository';
export type { AppliedDeduction } from './sla-desk.service';

import type { StaffRole } from './enums.js';

/**
 * The staff panel's desks and the roles that open each one — ADR-0025 D3 (Sprint 9) and ADR-0026
 * (Sprint 10). The single source for both the API guards and the panel's navigation.
 * SUPER_ADMIN opens every desk in every city and is not listed. Finer rules (who may approve a
 * refund, publish pricing, decide KYC) are checked per action on the server.
 */
export const ADMIN_DESKS = [
  'overview',
  'bookings',
  'dispatch',
  'qa',
  'incidents',
  'alerts',
  'reviews',
  'refunds',
  'payouts',
  'pricing',
  'photographers',
  'quality',
  'tickets',
  'claims',
  'breaches',
  'staff',
] as const;
export type AdminDesk = (typeof ADMIN_DESKS)[number];

const OPS_FLOOR: readonly StaffRole[] = ['CITY_MANAGER', 'OPS_AGENT', 'QUALITY_MANAGER', 'SUPPORT'];

export const ADMIN_DESK_ROLES: Readonly<Record<AdminDesk, readonly StaffRole[]>> = {
  /** "Today": the live numbers and the work waiting on each desk. */
  overview: [...OPS_FLOOR, 'FINANCE', 'READ_ONLY'],
  bookings: [...OPS_FLOOR, 'FINANCE', 'READ_ONLY'],
  dispatch: ['CITY_MANAGER', 'OPS_AGENT', 'SUPPORT', 'READ_ONLY'],
  qa: ['CITY_MANAGER', 'OPS_AGENT', 'QUALITY_MANAGER'],
  incidents: ['CITY_MANAGER', 'OPS_AGENT'],
  alerts: [...OPS_FLOOR, 'FINANCE', 'READ_ONLY'],
  /** Items waiting to be settled (refund due, credit due, charge due …). Settling: QM, finance. */
  reviews: [...OPS_FLOOR, 'FINANCE'],
  /** Request: everyone on the floor + finance. Approve: QM within its ceiling, finance any. */
  refunds: [...OPS_FLOOR, 'FINANCE'],
  payouts: ['FINANCE'],
  /** View: finance, city managers, read-only. Edit and publish: finance. */
  pricing: ['FINANCE', 'CITY_MANAGER', 'READ_ONLY'],
  /** Onboarding, KYC, directory, penalties. KYC decisions: city managers. */
  photographers: [...OPS_FLOOR, 'READ_ONLY'],
  quality: ['QUALITY_MANAGER', 'CITY_MANAGER', 'SUPPORT'],
  tickets: ['SUPPORT', 'CITY_MANAGER', 'QUALITY_MANAGER', 'OPS_AGENT'],
  claims: ['FINANCE', 'CITY_MANAGER', 'QUALITY_MANAGER'],
  /** Late deliveries: attribute or waive. */
  breaches: ['CITY_MANAGER', 'QUALITY_MANAGER'],
  staff: [],
};

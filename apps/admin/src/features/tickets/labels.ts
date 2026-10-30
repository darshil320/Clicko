import type {
  AdminTicketView,
  TicketCategory,
  TicketRaisedBy,
  TicketStatus,
} from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';

/** Ticket words for people, not codes (ADR-0026 D8). */

export const CATEGORY_LABEL: Readonly<Record<TicketCategory, string>> = {
  GRIEVANCE: 'Complaint (grievance)',
  DATA_DELETION: 'Delete my data',
  CONSENT_WITHDRAWAL: 'Withdraw consent',
  BILLING: 'Billing or payment',
  QUALITY: 'Photo quality',
  CONDUCT: 'Photographer conduct',
  APP_ISSUE: 'App problem',
  OTHER: 'Something else',
};

export const STATUS: Readonly<Record<TicketStatus, { label: string; tone: BadgeVariant }>> = {
  OPEN: { label: 'New', tone: 'warning' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'outline' },
  IN_PROGRESS: { label: 'In progress', tone: 'outline' },
  AWAITING_CUSTOMER: { label: 'Waiting on customer', tone: 'neutral' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export const RAISED_BY_LABEL: Readonly<Record<TicketRaisedBy, string>> = {
  USER: 'A client',
  PHOTOGRAPHER: 'A photographer',
  PUBLIC: 'Someone else (no account)',
};

export const VIEW_LABEL: Readonly<Record<AdminTicketView, string>> = {
  OPEN: 'Open',
  MINE: 'Mine',
  OVERDUE: 'Overdue',
  RESOLVED: 'Resolved',
};

export const ticketKeys = {
  all: ['care', 'tickets'] as const,
  list: (view: AdminTicketView) => ['care', 'tickets', 'list', view] as const,
  one: (id: string) => ['care', 'tickets', 'one', id] as const,
};

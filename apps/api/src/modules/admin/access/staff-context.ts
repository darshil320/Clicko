import type { StaffRole } from '@clickco/contracts';
import type { CityScope } from './roles';

/** What the staff guards and the audit interceptor put on the request (ADR-0025 D3/D4). */

export interface StaffGrantRecord {
  readonly id: string;
  readonly role: StaffRole;
  /** null = every city. */
  readonly cityId: string | null;
}

/** An ACTIVE staff account and its grants, loaded per request. */
export interface StaffPrincipal {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly grants: readonly StaffGrantRecord[];
}

/** The caller, plus the cities this route's roles open for them. */
export interface StaffCaller extends StaffPrincipal {
  readonly scope: CityScope;
}

export interface AuditActor {
  readonly kind: 'STAFF' | 'SYSTEM';
  readonly id: string | null;
  readonly email: string | null;
}

/** Request facts every audit row carries; built by AuditLogInterceptor. */
export interface AuditContext {
  readonly actor: AuditActor | null;
  /** The handler's @Audited action (null on reads). */
  readonly action: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

export const STAFF_ACCESS = Symbol('STAFF_ACCESS');

export interface StaffAccessPort {
  /** null when the account does not exist or is deactivated. */
  activePrincipal(staffId: string): Promise<StaffPrincipal | null>;
}

export type ScopedEntity = 'booking' | 'assignment' | 'breach';

export const CITY_RESOLVER = Symbol('CITY_RESOLVER');

export interface CityResolverPort {
  /** The city of the booking behind the entity; null when it does not exist. */
  cityOf(entity: ScopedEntity, id: string): Promise<string | null>;
}

export interface StaffRequest {
  readonly method: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly params: Record<string, string | undefined>;
  readonly ip?: string;
  subject?: { readonly kind: string; readonly id: string };
  staff?: StaffCaller;
  audit?: AuditContext;
}

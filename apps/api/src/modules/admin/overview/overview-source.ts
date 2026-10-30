import type { AdminDesk } from '@clickco/contracts';
import type { CityScope } from '../access/roles';
import type { StaffCaller } from '../access/staff-context';

/**
 * ADR-0026 D8/D9 — one count on the panel's "Today" page. Every number and every "Needs you"
 * card is a source: the overview asks each source the caller's roles can open, in the cities
 * that desk opens for them. A Sprint 10 desk plugs in by registering one (see
 * `OverviewRegistry.register`); the panel renders whatever comes back.
 */
export interface OverviewContext {
  readonly caller: StaffCaller;
  /** The cities the source's desk opens for this caller (a closed desk is never asked). */
  readonly scope: CityScope;
  readonly now: Date;
}

export interface OverviewSource {
  /** Stable id, unique in the registry, e.g. `refunds.awaiting_approval`. */
  readonly key: string;
  /** The desk this work lives on: counted only for callers who can open it. */
  readonly desk: AdminDesk;
  /** How many, in `ctx.scope`. Count in SQL in the owning module (never its tables from here). */
  readonly count: (ctx: OverviewContext) => Promise<number>;
  /** The read stops here (e.g. a page of 100): a count at the cap shows as "100+". */
  readonly cap?: number;
  /** A number in Today's row. Lower `order` comes first. */
  readonly tile?: { readonly label: string; readonly hint: string; readonly order: number };
  /**
   * A "Needs you" card — and the nav's live count — whenever the count is above zero. At most
   * one per desk. `line` is one plain sentence for the count ("3 shoots are waiting…").
   */
  readonly needsYou?: {
    readonly tone: 'attention' | 'urgent';
    readonly title: string;
    readonly line: (count: number) => string;
    readonly action: string;
  };
}

/** "1 shoot", "3 shoots" — for `needsYou.line`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "is" / "are" agreeing with `count`. */
export const isAre = (count: number): string => (count === 1 ? 'is' : 'are');

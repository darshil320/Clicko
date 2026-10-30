import { z } from 'zod';
import { AdminAlert } from './admin.js';
import { ADMIN_DESKS } from './admin-desks.js';
import { IsoDateTime } from './common.js';

/**
 * ADR-0026 D8 — "Today", the panel's home: `GET /admin/overview`. Role- and city-scoped on the
 * server: a count is only made for a desk the caller can open, within the cities that desk opens
 * for them. The counts come from a registry of sources (API `modules/admin/overview`), so a
 * Sprint 10 desk adds its number with one registration and the panel needs no change.
 */

export const AdminDeskName = z.enum(ADMIN_DESKS);
export type AdminDeskName = z.infer<typeof AdminDeskName>;

/** How much a number asks for attention. Never the only signal: the label says it too. */
export const AdminOverviewTone = z.enum(['neutral', 'attention', 'urgent']);
export type AdminOverviewTone = z.infer<typeof AdminOverviewTone>;

/** One live number in Today's row ("Shoots today: 14"). */
export const AdminOverviewTile = z.object({
  /** Stable id of the source, e.g. `bookings.today`. */
  key: z.string().regex(/^[a-z0-9_.-]+$/),
  /** Where the tile leads. Only desks the caller can open are counted at all. */
  desk: AdminDeskName,
  label: z.string(),
  /** One plain sentence on what is counted ("Scheduled to start today, IST"). */
  hint: z.string(),
  value: z.int().min(0),
  /** The read stopped at a cap: show `value+`. */
  capped: z.boolean(),
  tone: AdminOverviewTone,
});
export type AdminOverviewTile = z.infer<typeof AdminOverviewTile>;

/** A "Needs you" card: one per desk the caller can open that has work waiting. */
export const AdminNeedsYou = z.object({
  desk: AdminDeskName,
  count: z.int().min(1),
  capped: z.boolean(),
  /** "Waiting for QA" */
  title: z.string(),
  /** "3 shoots are waiting for a quality check." */
  line: z.string(),
  /** The one button: "Start checking". */
  action: z.string(),
  tone: AdminOverviewTone.exclude(['neutral']),
});
export type AdminNeedsYou = z.infer<typeof AdminNeedsYou>;

export const AdminOverview = z.object({
  generatedAt: IsoDateTime,
  tiles: z.array(AdminOverviewTile),
  /** Most urgent first, then the largest count. */
  needsYou: z.array(AdminNeedsYou),
  /** The newest alerts in the caller's cities (empty when the alerts desk is closed to them). */
  latestAlerts: z.array(AdminAlert).max(10),
  /** A count could not be read just now; everything shown is still current. */
  incomplete: z.boolean(),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

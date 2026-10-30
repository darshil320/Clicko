import type postgres from 'postgres';
import type { BookingScope, Db, TicketScope } from '../care.types';

/** SQL fragments shared by the care repositories. */

export function and(db: Db, parts: readonly postgres.PendingQuery<postgres.Row[]>[]) {
  return parts.reduce((acc, part) => db`${acc} AND ${part}`, db`TRUE`);
}

/** `<column> IN (<owner-built booking subquery>)`, or TRUE without a city limit. */
export function scopeClause(
  db: Db,
  column: 'q.booking_id' | 'c.booking_id',
  bookings: BookingScope,
) {
  return bookings ? db`${db.unsafe(column)} IN (${bookings})` : db`TRUE`;
}

/** A ticket is visible through its booking's city or its photographer's city. */
export function ticketScopeClause(db: Db, scope: TicketScope) {
  if (!scope) return db`TRUE`;
  return db`(t.booking_id IN (${scope.bookings}) OR t.photographer_id IN (${scope.photographers}))`;
}

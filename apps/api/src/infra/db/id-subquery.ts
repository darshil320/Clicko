import type postgres from 'postgres';

/**
 * A subquery yielding one uuid column, built by the module that OWNS the table it reads.
 * Another module embeds it (`WHERE booking_id IN (${sub})`) to filter in SQL — e.g. the admin
 * desks' city scope (ADR-0025 D3) — without ever naming that module's tables itself.
 */
export type IdSubquery = postgres.PendingQuery<postgres.Row[]>;

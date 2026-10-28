import {
  type AdminBookingQuery,
  type AdminBreachQuery,
  type AdminListQuery,
  Uuid,
} from '@clickco/contracts';
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';

/** Parsed (defaults applied) admin list queries. */
export type ListQuery = z.output<typeof AdminListQuery>;
export type BreachQuery = z.output<typeof AdminBreachQuery>;
export type BookingQuery = z.output<typeof AdminBookingQuery>;

const INVALID_CURSOR = { code: 'INVALID_CURSOR', message: 'This page link is no longer valid' };

/** Opaque keyset cursor: base64url JSON of the last row's sort key. */
export function encodeCursor(key: Readonly<Record<string, string>>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor<S extends z.ZodType>(
  schema: S,
  raw: string | undefined,
): z.infer<S> | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  throw new BadRequestException(INVALID_CURSOR);
}

/** (time, uuid) keyset — bookings, dispatch, QA, breaches. */
export const TimeCursor = z.object({ t: z.iso.datetime(), i: Uuid });
export type TimeCursor = z.infer<typeof TimeCursor>;

/** (time, bigserial id) keyset — incident reports and alerts; 18 digits always fit a bigint. */
export const TimeSeqCursor = z.object({ t: z.iso.datetime(), i: z.string().regex(/^\d{1,18}$/) });
export type TimeSeqCursor = z.infer<typeof TimeSeqCursor>;

/** One page of `limit` from `limit + 1` fetched rows. */
export function pageOf<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => Readonly<Record<string, string>>,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}

/** IST calendar day (YYYY-MM-DD) → the UTC instant it starts. */
export const istDayStart = (day: string): Date => new Date(`${day}T00:00:00+05:30`);
export const DAY_MS = 86_400_000;

const BOOLEAN_TEXT: Readonly<Record<string, boolean>> = {
  true: true,
  '1': true,
  false: false,
  '0': false,
};
const BOOLEAN_KEYS = new Set(['needsAttention']);
const NUMBER_KEYS = new Set(['limit']);

/**
 * Query strings → the contract's types before validation: keys in `arrayKeys` become arrays
 * (`status=QA&status=X` or `status=QA,X`); `needsAttention=true|1|false|0` → boolean;
 * `limit=20` → number. Anything else passes through for the schema to judge.
 */
export function normaliseQuery(
  raw: unknown,
  arrayKeys: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
      if (arrayKeys.has(key)) {
        const list = (Array.isArray(value) ? value : [value])
          .flatMap((v) => String(v).split(','))
          .map((v) => v.trim())
          .filter(Boolean);
        return [key, list];
      }
      if (BOOLEAN_KEYS.has(key) && typeof value === 'string') {
        return [key, BOOLEAN_TEXT[value] ?? value];
      }
      if (NUMBER_KEYS.has(key) && typeof value === 'string' && /^\d{1,4}$/.test(value)) {
        return [key, Number(value)];
      }
      return [key, value];
    }),
  );
}

/** ZodValidationPipe for GET queries (see normaliseQuery). */
export class AdminQueryPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  private readonly inner: ZodValidationPipe<S>;
  private readonly arrayKeys: ReadonlySet<string>;

  constructor(schema: S, arrayKeys: readonly string[] = []) {
    this.inner = new ZodValidationPipe(schema);
    this.arrayKeys = new Set(arrayKeys);
  }

  transform(value: unknown): z.infer<S> {
    return this.inner.transform(normaliseQuery(value, this.arrayKeys));
  }
}

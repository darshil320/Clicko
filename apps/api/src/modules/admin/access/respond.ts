import type { z } from 'zod';
import { type Envelope, ok } from '../../../common/envelope';

/**
 * Every /admin answer is parsed against its contract before it leaves (the panel parses it too).
 * A mismatch is a server bug: it surfaces as a logged 500, never as an unvalidated body.
 */
export function respond<S extends z.ZodType>(schema: S, data: z.input<S>): Envelope<z.output<S>> {
  return ok(schema.parse(data));
}

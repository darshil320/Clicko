import { z } from 'zod';
import { ApiError, invalidResponse } from './errors.js';

/** The API's one response shape: { success, data, error: { code, message, details? } }. */
const EnvelopeShape = z.object({
  success: z.boolean(),
  data: z.unknown(),
  error: z
    .union([
      z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
      z.string(),
    ])
    .nullable(),
});

/**
 * Unwraps an envelope and validates `data` against the contract schema. Never trusts the
 * wire: a body that is not an envelope, or data that breaks the contract, is an
 * INVALID_RESPONSE rather than a silently wrong value.
 */
export function unwrapEnvelope<T>(status: number, body: unknown, schema: z.ZodType<T>): T {
  const envelope = EnvelopeShape.safeParse(body);
  if (!envelope.success) {
    throw invalidResponse(status, `Unexpected response from the server (HTTP ${status})`);
  }
  const { success, data, error } = envelope.data;

  if (!success || status >= 400) {
    const detail =
      typeof error === 'string' || error === null
        ? { code: 'ERROR', message: error ?? 'Request failed' }
        : error;
    throw new ApiError({
      kind: 'HTTP',
      status,
      code: detail.code,
      message: detail.message,
      details: 'details' in detail ? detail.details : undefined,
    });
  }

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw invalidResponse(
      status,
      'The server response did not match the expected shape',
      parsed.error.issues,
    );
  }
  return parsed.data;
}

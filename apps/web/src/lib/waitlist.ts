/**
 * Waitlist request/response handling for POST /waitlist.
 * The body mirrors `JoinWaitlistBody` in packages/contracts/src/serviceability.ts and the
 * response follows the API envelope (apps/api/src/common/envelope.ts). apps/web does not depend
 * on @clickco/contracts, so the shape is restated here — keep the two in step.
 */

export interface WaitlistRequest {
  readonly phone: string;
  readonly fullName: string;
  readonly pincode: string;
  readonly intendedDate?: string;
}

export interface WaitlistInput {
  readonly fullName: string;
  readonly phone: string;
  readonly pincode: string;
  readonly intendedDate: string;
}

export type WaitlistField = keyof WaitlistInput;
export type FieldErrors = Partial<Record<WaitlistField, string>>;

export type Validation =
  | { readonly ok: true; readonly body: WaitlistRequest }
  | { readonly ok: false; readonly errors: FieldErrors };

const PINCODE = /^[1-9]\d{5}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_MAX = 120;

type BuildEnv = Readonly<Record<string, string | undefined>>;

const LOCAL_API = 'http://localhost:4000';

/** Built on Vercel (any environment), with CLICKCO_DEPLOY=1, or with `build:production`. */
export function isDeployBuild(env: BuildEnv): boolean {
  return env.VERCEL === '1' || isProductionBuild(env);
}

/** The production site: Vercel production, CLICKCO_DEPLOY=1, or `build:production`. */
export function isProductionBuild(env: BuildEnv): boolean {
  return env.VERCEL_ENV === 'production' || env.CLICKCO_DEPLOY === '1' || env.LEGAL_STRICT === '1';
}

/** Where the form posts, or why it is switched off. */
export type WaitlistConfig =
  | { readonly kind: 'live'; readonly endpoint: string }
  | { readonly kind: 'unavailable' };

/**
 * Decides at build time where the waitlist form posts (audit M1). Vercel builds with plain
 * `build`, so this cannot rely on `build:production`:
 * - local builds fall back to the local API;
 * - a deploy build never posts to localhost: with no API URL the site shows "Waitlist opens soon";
 * - a production build with an API URL that is not https fails, as does `build:production`
 *   (LEGAL_STRICT=1) with none at all.
 * Throws with the problem; the build must stop.
 */
export function resolveWaitlist(env: BuildEnv): WaitlistConfig {
  const configured = env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) {
    if (env.LEGAL_STRICT === '1') {
      throw new Error('NEXT_PUBLIC_API_URL must be set for a production build (waitlist form).');
    }
    return isDeployBuild(env)
      ? { kind: 'unavailable' }
      : { kind: 'live', endpoint: waitlistEndpoint(LOCAL_API) };
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL is not a valid URL: ${configured}`);
  }
  if (isDeployBuild(env) && url.protocol !== 'https:') {
    if (isProductionBuild(env)) {
      throw new Error('NEXT_PUBLIC_API_URL must be an https:// URL in production.');
    }
    return { kind: 'unavailable' };
  }
  return { kind: 'live', endpoint: waitlistEndpoint(configured) };
}

export function waitlistEndpoint(base: string | undefined): string {
  const origin = (base?.trim() || LOCAL_API).replace(/\/+$/, '');
  return `${origin}/waitlist`;
}

/** "98765 43210", "+91-98765-43210", "098765 43210" → "+919876543210"; anything else → null. */
export function normaliseIndianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  const match = digits.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  return match?.[1] ? `+91${match[1]}` : null;
}

export function validateWaitlist(input: WaitlistInput): Validation {
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const phone = normaliseIndianMobile(input.phone);
  const pincode = input.pincode.replace(/\s/g, '');
  const intendedDate = input.intendedDate.trim();

  const errors: FieldErrors = {
    ...(fullName.length === 0 ? { fullName: 'Please enter your name.' } : {}),
    ...(fullName.length > NAME_MAX ? { fullName: 'Please shorten your name.' } : {}),
    ...(phone ? {} : { phone: 'Enter a 10-digit Indian mobile number.' }),
    ...(PINCODE.test(pincode) ? {} : { pincode: 'Enter a 6-digit pincode.' }),
    ...(intendedDate && !ISO_DATE.test(intendedDate) ? { intendedDate: 'Pick a valid date.' } : {}),
  };
  if (Object.keys(errors).length > 0 || !phone) return { ok: false, errors };

  return {
    ok: true,
    body: { phone, fullName, pincode, ...(intendedDate ? { intendedDate } : {}) },
  };
}

export type WaitlistOutcome =
  | { readonly kind: 'joined'; readonly waitingCount: number }
  | { readonly kind: 'already-serviceable' }
  | { readonly kind: 'not-serviceable' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'error' };

function errorOf(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null || !('error' in body)) return {};
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return {};
  const { code, message } = error as { code?: unknown; message?: unknown };
  return {
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof message === 'string' ? { message } : {}),
  };
}

function waitingCountOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('data' in body)) return null;
  const data = (body as { data: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const count = (data as { waitingCount?: unknown }).waitingCount;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}

/** Maps an HTTP status + envelope body onto something the form can say to a person. */
export function interpretWaitlistResponse(status: number, body: unknown): WaitlistOutcome {
  if (status >= 200 && status < 300) {
    const waitingCount = waitingCountOf(body);
    return waitingCount === null ? { kind: 'error' } : { kind: 'joined', waitingCount };
  }
  const { code, message } = errorOf(body);
  if (status === 409 || code === 'ALREADY_SERVICEABLE') return { kind: 'already-serviceable' };
  if (status === 429 || code === 'RATE_LIMITED') return { kind: 'rate-limited' };
  if (code === 'NOT_SERVICEABLE') return { kind: 'not-serviceable' };
  if (code === 'DATE_OUT_OF_RANGE' && message) return { kind: 'invalid', message };
  if (status === 400 || status === 422) {
    return { kind: 'invalid', message: 'Please check your details and try again.' };
  }
  return { kind: 'error' };
}

export interface OutcomeMessage {
  readonly tone: 'success' | 'info' | 'error';
  readonly title: string;
  readonly detail: string;
}

export function outcomeMessage(outcome: WaitlistOutcome, pincode: string): OutcomeMessage {
  switch (outcome.kind) {
    case 'joined':
      return {
        tone: 'success',
        title: 'You’re on the list.',
        detail:
          outcome.waitingCount > 1
            ? `${outcome.waitingCount} people near ${pincode} are waiting. We’ll message you when Clickco reaches you.`
            : `You’re the first near ${pincode}. We’ll message you when Clickco reaches you.`,
      };
    case 'already-serviceable':
      return {
        tone: 'info',
        title: `Good news — we already serve ${pincode}.`,
        detail:
          'No need to wait: you can book this pincode in the Clickco app as soon as it launches.',
      };
    case 'not-serviceable':
      return {
        tone: 'info',
        title: 'We can’t serve this pincode.',
        detail: 'Sorry — this area is outside where we can send photographers.',
      };
    case 'rate-limited':
      return {
        tone: 'error',
        title: 'Too many sign-ups just now.',
        detail:
          'We’ve had a lot of waitlist requests from this number, network or pincode. Please try again later.',
      };
    case 'invalid':
      return { tone: 'error', title: 'Something doesn’t look right.', detail: outcome.message };
    case 'error':
      return {
        tone: 'error',
        title: 'We couldn’t add you just now.',
        detail: 'Please check your connection and try again in a minute.',
      };
  }
}

/** One PASS/FAIL/SKIP/WAIT line per step, written to stdout. */

export type StepOutcome =
  | { readonly kind: 'PASS'; readonly detail: string }
  | { readonly kind: 'SKIP'; readonly detail: string }
  | { readonly kind: 'WAIT'; readonly until: string; readonly detail: string };

/** Thrown by a step that cannot run yet (check-out before the booked time is over). */
export class StepNotYet extends Error {
  constructor(
    readonly until: string,
    message: string,
  ) {
    super(message);
    this.name = 'StepNotYet';
  }
}

const pad = (text: string, width: number): string => text.padEnd(width, ' ');

export function line(
  status: 'PASS' | 'FAIL' | 'SKIP' | 'WAIT',
  index: number,
  name: string,
  detail: string,
  ms?: number,
): string {
  const n = String(index).padStart(2, '0');
  const took = ms === undefined ? '' : ` (${ms} ms)`;
  return `${pad(status, 4)}  ${n} ${pad(name, 26)} ${detail}${took}`;
}

/** An error as one line, with the API's code and details when it has them. */
export function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const e = error as { code?: unknown; status?: unknown; message?: unknown; details?: unknown };
  const head = [e.status, e.code].filter((v) => v !== undefined && v !== '').join(' ');
  const message = typeof e.message === 'string' ? e.message : String(error);
  const details = e.details === undefined ? '' : ` ${JSON.stringify(e.details)}`;
  return `${head ? `${head}: ` : ''}${message}${details}`;
}

/**
 * The dry run's progress on disk, so a run paused before check-out (the booked hours must pass
 * in real time) resumes where it stopped. Holds refresh tokens of the run's own accounts: the
 * file is written 0600 and is git-ignored. Delete it after the run.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface SavedTokens {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
}

export interface DryRunState {
  readonly version: 1;
  readonly api: string;
  readonly startedAt: string;
  readonly clientPhone: string;
  /** Step ids already passed, in order. */
  readonly done: readonly string[];
  readonly bookingId?: string;
  readonly bookingReference?: string;
  readonly scheduledStart?: string;
  readonly photographerId?: string;
  readonly photographerName?: string;
  readonly photographerPhone?: string;
  readonly assignmentId?: string;
  readonly uploadSessionId?: string;
  /** file name → sha256 of what was uploaded (checked against the delivered bytes). */
  readonly uploaded?: Readonly<Record<string, string>>;
  readonly clientTokens?: SavedTokens;
  readonly proTokens?: SavedTokens;
}

export function freshState(api: string, clientPhone: string, now: Date): DryRunState {
  return { version: 1, api, startedAt: now.toISOString(), clientPhone, done: [] };
}

export function loadState(file: string): DryRunState {
  if (!existsSync(file)) throw new Error(`No saved run at ${file}`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<DryRunState>;
  if (parsed.version !== 1 || typeof parsed.api !== 'string' || !Array.isArray(parsed.done)) {
    throw new Error(`${file} is not a dry-run state file`);
  }
  return parsed as DryRunState;
}

export function saveState(file: string, state: DryRunState): void {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

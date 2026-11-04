/**
 * What every step can reach: the options, the saved progress, and the three actors' SDK clients.
 * Progress is replaced, never edited in place, and written to disk on every change.
 */
import type { DryRunOptions } from './options.js';
import type { ApiClient, ProApiClient, TokenStore } from './sdk.js';
import { clientApi, proApi, tokenStore } from './sessions.js';
import { type DryRunState, saveState } from './state.js';

export interface Step {
  readonly id: string;
  readonly name: string;
  run(ctx: RunContext): Promise<string>;
}

export class RunContext {
  private current: DryRunState;
  readonly clientTokens: TokenStore;
  readonly proTokens: TokenStore;
  readonly client: ApiClient;
  readonly pro: ProApiClient;

  constructor(
    readonly options: DryRunOptions,
    initial: DryRunState,
  ) {
    this.current = initial;
    this.save();
    this.clientTokens = tokenStore(initial.clientTokens, (t) => this.update({ clientTokens: t }));
    this.proTokens = tokenStore(initial.proTokens, (t) => this.update({ proTokens: t }));
    this.client = clientApi(options.api, this.clientTokens);
    this.pro = proApi(options.api, this.proTokens);
  }

  get state(): DryRunState {
    return this.current;
  }

  update(patch: Partial<Omit<DryRunState, 'version'>>): void {
    this.current = { ...this.current, ...patch };
    this.save();
  }

  markDone(stepId: string): void {
    if (!this.current.done.includes(stepId)) this.update({ done: [...this.current.done, stepId] });
  }

  /** A value an earlier step saved; a clear error if the run file lacks it. */
  need<K extends keyof DryRunState>(key: K): NonNullable<DryRunState[K]> {
    const value = this.current[key];
    if (value === undefined || value === null) {
      throw new Error(`The run has no ${String(key)} yet (an earlier step did not finish)`);
    }
    return value as NonNullable<DryRunState[K]>;
  }

  private save(): void {
    saveState(this.options.stateFile, this.current);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `read` until `done` holds, or fails with the last value seen. */
export async function waitFor<T>(
  what: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 60_000, intervalMs = 1_000 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await read();
  while (!done(last)) {
    if (Date.now() > deadline) {
      const seen = JSON.stringify(last)?.slice(0, 300) ?? String(last);
      throw new Error(`Timed out after ${timeoutMs / 1000} s waiting for ${what}; last: ${seen}`);
    }
    await sleep(intervalMs);
    last = await read();
  }
  return last;
}

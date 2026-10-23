/**
 * Honest progress (doc 02 §7): only bytes the server acknowledged count, and the ETA comes from the
 * rate actually achieved over the last 30 s — a photographer watching 18 GB must trust the number.
 */

interface Sample {
  readonly at: number;
  readonly bytes: number;
}

export class RateMeter {
  private samples: readonly Sample[] = [];

  constructor(private readonly windowMs = 30_000) {}

  record(at: number, bytes: number): void {
    this.samples = [...this.samples.filter((s) => at - s.at <= this.windowMs), { at, bytes }];
  }

  /** Bytes per second over the window, or null until two samples span at least a second. */
  bytesPerSecond(at: number): number | null {
    const recent = this.samples.filter((s) => at - s.at <= this.windowMs);
    const first = recent[0];
    if (!first || recent.length < 2) return null;
    const spanMs = Math.max(at, (recent.at(-1) as Sample).at) - first.at;
    if (spanMs < 1_000) return null;
    // The first sample marks the start of the window; its bytes were sent before it.
    const sent = recent.slice(1).reduce((sum, s) => sum + s.bytes, 0);
    return (sent * 1_000) / spanMs;
  }
}

/** Seconds left at the current rate, or null when there is no rate yet. */
export function etaSeconds(remainingBytes: number, bytesPerSecond: number | null): number | null {
  if (remainingBytes <= 0) return 0;
  if (bytesPerSecond === null || bytesPerSecond <= 0) return null;
  return Math.ceil(remainingBytes / bytesPerSecond);
}

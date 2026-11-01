/**
 * Masked calls (ADR-0027 D3, DOMAIN Invariant 11): the provider rings the caller first from a
 * virtual number, then bridges the other side — who also sees only the virtual number. Neither
 * real number ever reaches the other party or an API response. Console adapter in development
 * and test; Exotel when deployed (env.ts refuses the console there).
 */
export class CallConnectError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`Call connect failed: ${code}`);
    this.name = 'CallConnectError';
  }
}

export interface ConnectCallRequest {
  /** E.164: rung first (the person who tapped "call"). */
  readonly from: string;
  /** E.164: bridged once `from` answers. */
  readonly to: string;
  /** Clickco's id for this call: comes back on the status callback. */
  readonly callId: string;
  /** Where the provider posts the final status and duration; null when not configured. */
  readonly statusCallbackUrl: string | null;
  readonly timeLimitSeconds: number;
}

export interface CallReceipt {
  readonly provider: string;
  readonly providerCallId: string | null;
}

export interface CallsPort {
  readonly provider: string;
  /** The virtual number (ExoPhone) both sides see. */
  readonly virtualNumber: string;
  connect(request: ConnectCallRequest): Promise<CallReceipt>;
}
export const CALLS_PORT = Symbol('CALLS_PORT');

/**
 * REQUESTED: reserved under a lock before the provider is asked (the rate limits count it).
 * INITIATED: the provider accepted (its id recorded). Then FAILED, or the final status.
 */
export type CallStatus = 'REQUESTED' | 'INITIATED' | 'FAILED' | 'COMPLETED' | 'NO_ANSWER' | 'BUSY';

/** A provider's final word on a call (from its status callback). */
export interface CallStatusUpdate {
  readonly providerCallId: string;
  readonly status: Exclude<CallStatus, 'REQUESTED' | 'INITIATED'>;
  /** Seconds the two sides talked; only ever the duration — never a recording. */
  readonly durationSeconds: number | null;
}

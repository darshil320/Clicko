import type { SessionEndReason } from './reset';

/** What this phone holds for a signed-in account, as the erase needs to reach it. */
export interface DeviceData {
  /**
   * Forgets the tokens and the user, then runs every registered session-end reset (booking draft,
   * idempotency key rings, query cache, and for a deleted account the shoot location).
   */
  endSession(reason: SessionEndReason): void;
  /** Removes every key in the app's key-value store, including keys no reset knows about. */
  wipeStorage(): void;
}

/**
 * ADR-0030: once the API has deleted the account, nothing of it stays on the phone. The ordinary
 * sign-out path runs first, so every in-memory store is empty too (a later write cannot bring
 * an old value back); then the store itself is wiped. Pure: the session store binds it
 * (`eraseThisDevice`).
 */
export function eraseDeletedAccount(device: DeviceData): void {
  device.endSession('account-deleted');
  device.wipeStorage();
}

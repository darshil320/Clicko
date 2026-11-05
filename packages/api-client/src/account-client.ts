import {
  AccountDeletionChallenge,
  AccountDeletionPreview,
  AccountDeletionResult,
  ConfirmAccountDeletionBody,
} from '@clickco/contracts';
import type { Http } from './http.js';

/**
 * ADR-0030: the client app's Profile → "Delete account" (Apple 5.1.1(v), DPDP s.12). Read the
 * preview (what goes, what stays, or why not now), ask for a code to the account's phone, then
 * confirm with it. Confirm takes one Idempotency-Key per intent: a retried tap after a lost answer
 * replays it. On success the app clears its stored session: every token is already revoked.
 */
export function accountApi(http: Http) {
  return {
    /** No side effects. `canDelete: false` comes with one plain sentence per blocking booking. */
    deletion: () =>
      http.request({
        method: 'GET',
        path: '/me/deletion',
        schema: AccountDeletionPreview,
        auth: true,
      }),
    /** Sends a 6-digit code to the account's phone. 409 ACCOUNT_DELETION_BLOCKED with blockers. */
    requestDeletion: () =>
      http.request({
        method: 'POST',
        path: '/me/deletion/request',
        schema: AccountDeletionChallenge,
        auth: true,
      }),
    /** 422 OTP_INVALID for a wrong or expired code (not a session error). */
    confirmDeletion: async (
      body: ConfirmAccountDeletionBody,
      { idempotencyKey }: { readonly idempotencyKey: string },
    ) =>
      http.request({
        method: 'POST',
        path: '/me/deletion/confirm',
        body: ConfirmAccountDeletionBody.parse(body),
        schema: AccountDeletionResult,
        auth: true,
        idempotencyKey,
      }),
  };
}

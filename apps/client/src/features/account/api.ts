import type { ConfirmAccountDeletionBody } from '@clickco/contracts';
import { api } from '@/shared/api';

/** What deleting erases and keeps, the credit that is lost, and anything that stops it now. */
export const fetchDeletionPreview = () => api.account.deletion();

/** Texts a 6-digit code to the account's own phone (409 ACCOUNT_DELETION_BLOCKED while blocked). */
export const requestDeletion = () => api.account.requestDeletion();

/** Deletes the account. One Idempotency-Key per intent (the account key ring). */
export const confirmDeletion = (body: ConfirmAccountDeletionBody, idempotencyKey: string) =>
  api.account.confirmDeletion(body, { idempotencyKey });

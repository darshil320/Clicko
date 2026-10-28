import { api } from '@/shared/api';

export const listOffers = () => api.offers.list();

/** The key is fixed per offer intent by the caller, so a retry never accepts twice. */
export const acceptOffer = (attemptId: string, idempotencyKey: string) =>
  api.offers.accept(attemptId, { idempotencyKey });

export const declineOffer = (attemptId: string, reason: string | null) =>
  api.offers.decline(attemptId, reason ? { reason } : {});

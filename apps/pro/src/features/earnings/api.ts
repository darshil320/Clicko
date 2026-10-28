import { api } from '@/shared/api';

/** Expected gross payouts for checked-out shoots (basis EXPECTED until payouts, S8). */
export const fetchEarnings = () => api.earnings();

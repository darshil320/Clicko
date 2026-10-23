import { api } from '@/shared/api';
import { assertDevBuild } from '@/shared/config';

export const requestOtp = (phone: string) => api.auth.requestOtp({ phone, purpose: 'LOGIN' });

export const verifyOtp = (input: { challengeId: string; phone: string; code: string }) =>
  api.auth.verifyOtp(input);

export const fetchMe = () => api.me();

export const logout = (refreshToken: string) => api.auth.logout(refreshToken);

/** Development only — answers 404 against any non-development API. */
export const fetchDevOtp = async (phone: string) => {
  assertDevBuild('Reading the dev OTP');
  return api.dev.latestOtp(phone);
};

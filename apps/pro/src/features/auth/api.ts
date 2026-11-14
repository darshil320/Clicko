import { api } from '@/shared/api';
import { assertDevBuild } from '@/shared/config';
import { SIGN_IN_CONSENT } from './lib/phone';

export const requestOtp = (phone: string) => api.auth.requestOtp(phone);

export const verifyOtp = (input: {
  challengeId: string;
  phone: string;
  code: string;
  deviceId: string;
}) => api.auth.verifyOtp({ ...input, consent: SIGN_IN_CONSENT });

export const logout = (refreshToken: string) => api.auth.logout(refreshToken);

/** Development only — answers 404 against any non-development API. */
export const fetchDevOtp = async (phone: string) => {
  assertDevBuild('Reading the dev OTP');
  return api.dev.latestOtp(phone);
};

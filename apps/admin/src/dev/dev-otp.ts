'use client';

import { api } from './api';

/** Reads the dev-only OTP, retrying briefly: SMS is sent by a background job. */
export async function readDevOtp(phone: string): Promise<string | null> {
  for (let i = 0; i < 10; i += 1) {
    const r = await api<{ code: string }>(`/dev/otp/${encodeURIComponent(phone)}`);
    if (r.ok) return r.data.code;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

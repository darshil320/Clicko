/**
 * Free text a client typed (address, landmark, special requirements) can carry a phone number.
 * Photographers never see client numbers (DOMAIN Invariant 11): any run of 10+ digits —
 * spaces, dashes, dots and brackets allowed in between, optional + — is hidden. Shorter numbers
 * (pincodes, house and flat numbers) are left alone.
 */
const CANDIDATE = /[+(]?\d[\d\s().-]{7,}\d/g;
const MIN_PHONE_DIGITS = 10;
export const HIDDEN_NUMBER = '[number hidden]';

export function maskPhoneNumbers(text: string): string {
  return text.replace(CANDIDATE, (run) =>
    run.replace(/\D/g, '').length >= MIN_PHONE_DIGITS ? HIDDEN_NUMBER : run,
  );
}

export function maskOrNull(text: string | null): string | null {
  return text === null ? null : maskPhoneNumbers(text);
}

/** 3.26 km → 3.5 km: enough to judge the trip, not to triangulate the venue. */
export function roundToHalfKm(km: number | null): number | null {
  return km === null ? null : Math.round(km * 2) / 2;
}

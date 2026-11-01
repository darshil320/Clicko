/**
 * What notification rows and logs may show of a destination (ADR-0027: never a full phone number
 * or push token). A push token's tail is enough to tell two devices apart.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `******${digits.slice(-4)}` : '******';
}

export function maskPushToken(token: string): string {
  const inner = /\[([^\]]+)\]$/.exec(token)?.[1] ?? '';
  return inner.length >= 4 ? `ExponentPushToken[…${inner.slice(-4)}]` : 'ExponentPushToken[…]';
}

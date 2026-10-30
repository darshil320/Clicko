/** What staff see on screen: never a full PAN or account number (pure). */

const PAN_VISIBLE = 4;

/** 'ABCPE1234F' → 'XXXXXX234F'. */
export function maskPan(pan: string | null): string | null {
  if (pan === null) return null;
  return `${'X'.repeat(Math.max(0, pan.length - PAN_VISIBLE))}${pan.slice(-PAN_VISIBLE)}`;
}

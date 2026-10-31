/**
 * Audit M2: the only URL a KYC document is ever opened from — an object URL this tab made from
 * bytes the API streamed through the staff session (`blob:<this origin>/…`). Anything else (a
 * provider link, a script or data URL, another origin's blob) is refused: null.
 */
export function documentHref(url: string | null, origin: string): string | null {
  if (!url || !origin) return null;
  return url.startsWith(`blob:${origin}/`) ? url : null;
}

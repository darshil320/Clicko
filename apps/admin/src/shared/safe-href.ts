/**
 * A link from stored data, safe to put in an `href`: only https (or http when allowed), never a
 * script or data URL. null when it is anything else.
 */
export function safeHref(url: string | null, allowHttp = false): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || (allowHttp && protocol === 'http:') ? url : null;
  } catch {
    return null;
  }
}

/**
 * Security audit L5: the development-only HTTP surface (/dev/*: OTP peek, payment simulator, …)
 * needs THREE things, not just NODE_ENV=development — an explicit `DEV_TOOLS=on`, and a database
 * on this machine, so a mis-set NODE_ENV on a server can never expose it.
 */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export interface DevToolsSource {
  readonly NODE_ENV?: string | undefined;
  readonly DEV_TOOLS?: string | undefined;
  readonly DATABASE_URL?: string | undefined;
}

export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function devToolsEnabled(source: DevToolsSource): boolean {
  return (
    source.NODE_ENV === 'development' &&
    source.DEV_TOOLS === 'on' &&
    isLocalDatabaseUrl(source.DATABASE_URL)
  );
}

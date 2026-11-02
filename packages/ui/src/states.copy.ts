import type { IconTileTone } from './tile.styles';

/**
 * The words and tones of the shared state blocks (EmptyState, ErrorState, OfflineBanner).
 * Short and plain; screens pass their own title ("We couldn't load your bookings") and the
 * app's one-sentence reason. Pure, so Vitest checks it without React Native.
 */
export const STATE_COPY = {
  retry: 'Try again',
  bannerRetry: 'Retry',
  errorBody: 'Something went wrong. Please try again.',
  offlineBody: 'Check your connection and try again.',
  offlineTitle: "You're offline",
  offlineBannerBody: "Check your connection. We'll refresh when you're back.",
  staleTitle: "Couldn't refresh",
  staleBody: 'Showing what we last loaded.',
} as const;

/** "page": centred and airy, the screen's whole body. "card": compact, inside a section. */
export type StateVariant = 'page' | 'card';

/** "offline": no connection. "stale": the last refresh failed, older data is on screen. */
export type BannerKind = 'offline' | 'stale';

export interface BannerContent {
  readonly title: string;
  readonly body: string;
  readonly tone: IconTileTone;
}

const BANNER: Readonly<Record<BannerKind, BannerContent>> = {
  offline: { title: STATE_COPY.offlineTitle, body: STATE_COPY.offlineBannerBody, tone: 'warning' },
  stale: { title: STATE_COPY.staleTitle, body: STATE_COPY.staleBody, tone: 'neutral' },
};

/** A banner's words (overridable per screen) and its calm tile tone. */
export function bannerContent(
  kind: BannerKind,
  overrides: { readonly title?: string | undefined; readonly body?: string | undefined } = {},
): BannerContent {
  const base = BANNER[kind];
  return {
    title: overrides.title ?? base.title,
    body: overrides.body ?? base.body,
    tone: base.tone,
  };
}

/** The reason an error block gives when the screen has none of its own. */
export function errorBody(offline: boolean, body?: string): string {
  if (body !== undefined && body.trim() !== '') return body;
  return offline ? STATE_COPY.offlineBody : STATE_COPY.errorBody;
}

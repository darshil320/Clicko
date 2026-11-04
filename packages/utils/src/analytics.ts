/**
 * ADR-0029 D4: the product-analytics port for the client and Pro apps. Framework-free: an app
 * builds one instance in its `src/shared/analytics.ts` with
 *   createAnalytics<AnalyticsCatalogue>({ adapter, validate: parseAnalyticsEvent,
 *                                         screens: ANALYTICS_SCREENS, enabled })
 * (catalogue and validator from @clickco/contracts). The adapter is `noopAnalyticsAdapter` until
 * posthog-react-native is approved; a PostHog adapter then implements the same three methods.
 * An event the catalogue rejects is dropped, never sent; nothing here ever throws into the app.
 */

export type AnalyticsValue = string | number | boolean;
export type AnalyticsProps = Readonly<Record<string, AnalyticsValue>>;

/** What a vendor SDK must provide (PostHog: capture, screen, reset). */
export interface AnalyticsAdapter {
  capture(event: string, props: AnalyticsProps): void;
  screen(name: string): void;
  /** Forget the anonymous install id (sign-out). */
  reset(): void;
}

export const noopAnalyticsAdapter: AnalyticsAdapter = {
  capture: () => {},
  screen: () => {},
  reset: () => {},
};

export interface Analytics<C extends { readonly [K in keyof C]: object }> {
  track<N extends keyof C & string>(name: N, props: C[N]): void;
  screen(name: string): void;
  reset(): void;
}

export interface AnalyticsOptions {
  readonly adapter: AnalyticsAdapter;
  /** The catalogue's validator: the props to send, or null to drop the event. */
  readonly validate: (name: string, props: unknown) => AnalyticsProps | null;
  /** Screen names that may be sent (route patterns). Anything else is dropped. Default: none. */
  readonly screens?: readonly string[];
  /** False until the person has agreed (and always false in tests). Default: on. */
  readonly enabled?: () => boolean;
  /** Told about each dropped event (log it in development). */
  readonly onInvalid?: (name: string) => void;
}

const quietly = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Analytics is never allowed to break a screen.
  }
};

export function createAnalytics<C extends { readonly [K in keyof C]: object }>(
  options: AnalyticsOptions,
): Analytics<C> {
  const { adapter, validate } = options;
  const screens = new Set(options.screens ?? []);
  const enabled = options.enabled ?? (() => true);
  return {
    track(name, props) {
      if (!enabled()) return;
      const valid = validate(name, props);
      if (valid === null) {
        quietly(() => options.onInvalid?.(name));
        return;
      }
      quietly(() => adapter.capture(name, valid));
    },
    screen(name) {
      if (!enabled() || !screens.has(name)) return;
      quietly(() => adapter.screen(name));
    },
    reset() {
      quietly(() => adapter.reset());
    },
  };
}

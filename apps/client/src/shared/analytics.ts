import {
  type AnalyticsCatalogue,
  CLIENT_ANALYTICS_SCREENS,
  parseAnalyticsEvent,
} from '@clickco/contracts';
import { createAnalytics, noopAnalyticsAdapter } from '@clickco/utils';

/**
 * Product analytics (ADR-0029 D4). Only events in the @clickco/contracts catalogue are sent,
 * with no personal data; anything else is dropped. The adapter is a no-op until the owner
 * approves posthog-react-native; swapping it is a one-line change here, no screen changes.
 *
 *   analytics.track('quote_viewed', { categoryCode, tier, hours, emergencyBand, priceBand })
 */
export const analytics = createAnalytics<AnalyticsCatalogue>({
  adapter: noopAnalyticsAdapter,
  validate: parseAnalyticsEvent,
  screens: CLIENT_ANALYTICS_SCREENS,
});

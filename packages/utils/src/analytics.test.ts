import { describe, expect, it } from 'vitest';
import {
  type AnalyticsAdapter,
  type AnalyticsProps,
  createAnalytics,
  noopAnalyticsAdapter,
} from './analytics.js';

interface TestCatalogue {
  readonly opened: Record<string, never>;
  readonly picked: { readonly tier: 'BASIC' | 'EXPERT' };
}

function recorder() {
  const calls: Array<readonly [string, ...unknown[]]> = [];
  const adapter: AnalyticsAdapter = {
    capture: (event, props) => calls.push(['capture', event, props]),
    screen: (name) => calls.push(['screen', name]),
    reset: () => calls.push(['reset']),
  };
  return { calls, adapter };
}

const validate = (name: string, props: unknown): AnalyticsProps | null =>
  name === 'picked' && (props as { tier?: string }).tier === 'BASIC'
    ? { tier: 'BASIC' }
    : name === 'opened'
      ? {}
      : null;

describe('createAnalytics (ADR-0029 D4)', () => {
  it('forwards only events the catalogue accepts, with the validated properties', () => {
    const { calls, adapter } = recorder();
    const analytics = createAnalytics<TestCatalogue>({ adapter, validate });
    analytics.track('picked', { tier: 'BASIC' });
    analytics.track('picked', { tier: 'EXPERT' });
    analytics.track('opened', {});
    expect(calls).toEqual([
      ['capture', 'picked', { tier: 'BASIC' }],
      ['capture', 'opened', {}],
    ]);
  });

  it('reports a dropped event to onInvalid (development warnings), never throws', () => {
    const dropped: string[] = [];
    const analytics = createAnalytics<TestCatalogue>({
      adapter: noopAnalyticsAdapter,
      validate,
      onInvalid: (name) => dropped.push(name),
    });
    expect(() => analytics.track('picked', { tier: 'EXPERT' })).not.toThrow();
    expect(dropped).toEqual(['picked']);
  });

  it('screens are restricted to the allowed list', () => {
    const { calls, adapter } = recorder();
    const analytics = createAnalytics<TestCatalogue>({
      adapter,
      validate,
      screens: ['/(tabs)/home'],
    });
    analytics.screen('/(tabs)/home');
    analytics.screen('/bookings/3f2b8a52-6c1e-4d7a-9b1f-0c8e2a4d5b6f');
    expect(calls).toEqual([['screen', '/(tabs)/home']]);
  });

  it('is silent while disabled (no consent yet), and reset always reaches the adapter', () => {
    const { calls, adapter } = recorder();
    let enabled = false;
    const analytics = createAnalytics<TestCatalogue>({ adapter, validate, enabled: () => enabled });
    analytics.track('opened', {});
    enabled = true;
    analytics.track('opened', {});
    analytics.reset();
    expect(calls).toEqual([['capture', 'opened', {}], ['reset']]);
  });

  it('an adapter that throws never breaks the app', () => {
    const analytics = createAnalytics<TestCatalogue>({
      adapter: {
        capture: () => {
          throw new Error('network');
        },
        screen: () => {
          throw new Error('network');
        },
        reset: () => {
          throw new Error('network');
        },
      },
      validate,
    });
    expect(() => {
      analytics.track('opened', {});
      analytics.screen('/(tabs)/home');
      analytics.reset();
    }).not.toThrow();
  });

  it('the no-op adapter does nothing', () => {
    expect(() => {
      noopAnalyticsAdapter.capture('x', {});
      noopAnalyticsAdapter.screen('x');
      noopAnalyticsAdapter.reset();
    }).not.toThrow();
  });
});

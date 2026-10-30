import { AdminOverview } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { istDay } from '../overview/ops-sources';
import { assembleOverview, type CountedSource } from '../overview/overview.assemble';
import { OverviewRegistry } from '../overview/overview.registry';
import { isAre, type OverviewSource, plural } from '../overview/overview-source';

const NOW = new Date('2026-10-30T09:30:00.000Z');

const source = (over: Partial<OverviewSource> & Pick<OverviewSource, 'key' | 'desk'>) =>
  ({ count: async () => 0, ...over }) as OverviewSource;

const needsYou = (tone: 'attention' | 'urgent', title = 'Work') => ({
  tone,
  title,
  line: (n: number) => `${plural(n, 'item')} ${isAre(n)} waiting.`,
  action: 'Open',
});

describe('assembleOverview (ADR-0026 D8)', () => {
  it('orders tiles, tints only a desk with work, and keeps a valid contract shape', () => {
    const counted: CountedSource[] = [
      {
        source: source({
          key: 'qa.waiting',
          desk: 'qa',
          tile: { label: 'Waiting for QA', hint: 'h', order: 40 },
          needsYou: needsYou('attention'),
        }),
        value: 3,
      },
      {
        source: source({
          key: 'bookings.today',
          desk: 'bookings',
          tile: { label: 'Shoots today', hint: 'h', order: 10 },
        }),
        value: 14,
      },
      {
        source: source({
          key: 'incidents.to_confirm',
          desk: 'incidents',
          tile: { label: 'Incidents', hint: 'h', order: 50 },
          needsYou: needsYou('urgent'),
        }),
        value: 0,
      },
    ];
    const o = assembleOverview(counted, [], NOW);
    expect(AdminOverview.parse(o)).toEqual(o);
    expect(o.tiles.map((t) => [t.key, t.value, t.tone])).toEqual([
      ['bookings.today', 14, 'neutral'],
      ['qa.waiting', 3, 'attention'],
      ['incidents.to_confirm', 0, 'neutral'],
    ]);
    expect(o.needsYou.map((n) => [n.desk, n.count, n.line])).toEqual([
      ['qa', 3, '3 items are waiting.'],
    ]);
    expect(o.generatedAt).toBe(NOW.toISOString());
    expect(o.incomplete).toBe(false);
  });

  it('puts urgent cards first, then the larger count, then the desk name', () => {
    const counted: CountedSource[] = [
      { source: source({ key: 'a', desk: 'qa', needsYou: needsYou('attention') }), value: 2 },
      { source: source({ key: 'b', desk: 'dispatch', needsYou: needsYou('attention') }), value: 5 },
      { source: source({ key: 'c', desk: 'incidents', needsYou: needsYou('urgent') }), value: 1 },
      { source: source({ key: 'd', desk: 'alerts', needsYou: needsYou('attention') }), value: 2 },
    ];
    const o = assembleOverview(counted, [], NOW);
    expect(o.needsYou.map((n) => n.desk)).toEqual(['incidents', 'dispatch', 'alerts', 'qa']);
    expect(o.needsYou[2]?.line).toBe('2 items are waiting.');
  });

  it('shows a capped read as the cap with `capped`', () => {
    const s = source({
      key: 'alerts.last_day',
      desk: 'alerts',
      cap: 100,
      tile: { label: 'Alerts', hint: 'h', order: 1 },
      needsYou: needsYou('attention'),
    });
    const o = assembleOverview([{ source: s, value: 100 }], [], NOW);
    expect(o.tiles[0]).toMatchObject({ value: 100, capped: true });
    expect(o.needsYou[0]).toMatchObject({ count: 100, capped: true });
    const under = assembleOverview([{ source: s, value: 99 }], [], NOW);
    expect(under.tiles[0]?.capped).toBe(false);
  });

  it('leaves out a failed read and says the page is incomplete', () => {
    const ok = source({ key: 'ok', desk: 'qa', tile: { label: 'OK', hint: 'h', order: 1 } });
    const bad = source({ key: 'bad', desk: 'qa', tile: { label: 'Bad', hint: 'h', order: 2 } });
    const o = assembleOverview(
      [
        { source: ok, value: 1 },
        { source: bad, value: null },
      ],
      [],
      NOW,
    );
    expect(o.tiles.map((t) => t.key)).toEqual(['ok']);
    expect(o.incomplete).toBe(true);
    expect(assembleOverview([{ source: ok, value: 1 }], null, NOW).incomplete).toBe(true);
  });
});

describe('OverviewRegistry', () => {
  it('takes each key once, one "Needs you" per desk, and refuses a source shown nowhere', () => {
    const registry = new OverviewRegistry();
    registry.register(source({ key: 'qa.waiting', desk: 'qa', needsYou: needsYou('attention') }));
    expect(() =>
      registry.register(
        source({ key: 'qa.waiting', desk: 'qa', tile: { label: 'x', hint: '', order: 1 } }),
      ),
    ).toThrow(/registered twice/);
    expect(() =>
      registry.register(source({ key: 'qa.other', desk: 'qa', needsYou: needsYou('urgent') })),
    ).toThrow(/one per desk/);
    expect(() => registry.register(source({ key: 'qa.none', desk: 'qa' }))).toThrow(
      /shows nowhere/,
    );
    registry.register(
      source({ key: 'qa.tile', desk: 'qa', tile: { label: 'QA', hint: '', order: 1 } }),
    );
    expect(registry.sources().map((s) => s.key)).toEqual(['qa.waiting', 'qa.tile']);
  });
});

describe('copy helpers and the IST day', () => {
  it('agrees in number', () => {
    expect(plural(1, 'shoot')).toBe('1 shoot');
    expect(plural(3, 'late delivery', 'late deliveries')).toBe('3 late deliveries');
    expect([isAre(1), isAre(0), isAre(2)]).toEqual(['is', 'are', 'are']);
  });

  it('finds the IST calendar day, across the UTC midnight', () => {
    expect(istDay(NOW)).toEqual({
      start: new Date('2026-10-29T18:30:00.000Z'),
      end: new Date('2026-10-30T18:30:00.000Z'),
    });
    // 11:00 pm UTC on the 30th is 4:30 am IST on the 31st.
    expect(istDay(new Date('2026-10-30T23:00:00.000Z')).start).toEqual(
      new Date('2026-10-30T18:30:00.000Z'),
    );
  });
});

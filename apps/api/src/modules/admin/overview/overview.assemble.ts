import type {
  AdminAlert,
  AdminNeedsYou,
  AdminOverview,
  AdminOverviewTile,
} from '@clickco/contracts';
import type { OverviewSource } from './overview-source';

/** A source's answer; null when its read failed (the rest of Today still shows). */
export interface CountedSource {
  readonly source: OverviewSource;
  readonly value: number | null;
}

const TONE_RANK = { urgent: 0, attention: 1 } as const;

function measured(source: OverviewSource, value: number): { value: number; capped: boolean } {
  const capped = source.cap !== undefined && value >= source.cap;
  return { value: capped && source.cap !== undefined ? source.cap : value, capped };
}

/**
 * Today's answer from the counted sources (ADR-0026 D8): tiles in their order, tinted when the
 * desk has work; one "Needs you" card per desk with work, most urgent first, then the largest
 * count; `incomplete` when a read failed. Pure, so the ordering rules are unit-tested.
 */
export function assembleOverview(
  counted: readonly CountedSource[],
  latestAlerts: readonly AdminAlert[] | null,
  now: Date,
): AdminOverview {
  const ok = counted.flatMap((c) => (c.value === null ? [] : [{ ...c, value: c.value }]));

  const tiles = ok
    .flatMap(({ source, value }) => (source.tile ? [{ source, tile: source.tile, value }] : []))
    .sort((a, b) => a.tile.order - b.tile.order || a.source.key.localeCompare(b.source.key))
    .map(
      ({ source, tile, value }): AdminOverviewTile => ({
        key: source.key,
        desk: source.desk,
        label: tile.label,
        hint: tile.hint,
        ...measured(source, value),
        tone: source.needsYou && value > 0 ? source.needsYou.tone : 'neutral',
      }),
    );

  const needsYou = ok
    .flatMap(({ source, value }) =>
      source.needsYou && value > 0 ? [{ source, needs: source.needsYou, value }] : [],
    )
    .sort(
      (a, b) =>
        TONE_RANK[a.needs.tone] - TONE_RANK[b.needs.tone] ||
        b.value - a.value ||
        a.source.desk.localeCompare(b.source.desk),
    )
    .map(({ source, needs, value }): AdminNeedsYou => {
      const m = measured(source, value);
      return {
        desk: source.desk,
        count: m.value,
        capped: m.capped,
        title: needs.title,
        line: needs.line(m.value),
        action: needs.action,
        tone: needs.tone,
      };
    });

  return {
    generatedAt: now.toISOString(),
    tiles,
    needsYou,
    latestAlerts: [...(latestAlerts ?? [])],
    incomplete: ok.length < counted.length || latestAlerts === null,
  };
}

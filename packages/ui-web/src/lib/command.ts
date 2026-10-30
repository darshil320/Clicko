/**
 * The command palette's keyboard and matching rules (ADR-0026 D8), pure so they are unit-tested.
 */

/** The next active row for an arrow key: wraps at both ends; -1 when there are no rows. */
export function moveActive(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return delta >= 0 ? 0 : count - 1;
  return (((index + delta) % count) + count) % count;
}

const fold = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Every word typed appears somewhere in the label or its keywords, in any order and case:
 * "late del" finds "Late deliveries", "money ref" finds "Refunds" (keywords: "money").
 */
export function matchesQuery(query: string, ...fields: ReadonlyArray<string | undefined>): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(fields.filter(Boolean).join(' '));
  return words.every((w) => haystack.includes(w));
}

/** Is this the palette's shortcut: ⌘K on a Mac, Ctrl+K elsewhere (either is accepted)? */
export function isPaletteShortcut(e: {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): boolean {
  return e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}

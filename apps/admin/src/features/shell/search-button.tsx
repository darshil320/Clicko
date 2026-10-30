'use client';

import { Button, isPaletteShortcut, Kbd, SearchIcon } from '@clickco/ui-web';
import { useEffect, useRef, useSyncExternalStore } from 'react';

/** ⌘ on a Mac (and iPad), Ctrl elsewhere — read once in the browser. */
function useIsApple(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );
}

/** ⌘K / Ctrl+K toggles the palette from anywhere in the panel (ADR-0026 D8). */
export function usePaletteShortcut(active: boolean, toggle: () => void): void {
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isPaletteShortcut(e)) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/**
 * The header's search: a wide, quiet field-like button on a laptop or tablet that shows the
 * shortcut, an icon button on a phone. Both open the ⌘K palette.
 */
export function SearchButton({
  onOpen,
  canSearchBookings,
}: {
  readonly onOpen: () => void;
  readonly canSearchBookings: boolean;
}) {
  const apple = useIsApple();
  const label = canSearchBookings ? 'Search bookings or jump to a desk' : 'Jump to a desk';
  return (
    <>
      <Button
        variant="outline"
        onClick={onOpen}
        aria-label={label}
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden h-9 w-full max-w-sm justify-start gap-2 font-normal text-muted-foreground shadow-none sm:flex"
      >
        <SearchIcon aria-hidden="true" />
        <span className="truncate">
          {canSearchBookings ? 'Search bookings, desks…' : 'Jump to a desk…'}
        </span>
        <Kbd aria-hidden="true" className="ml-auto">
          {apple ? '⌘ K' : 'Ctrl K'}
        </Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onOpen}
        aria-label={label}
        className="sm:hidden"
      >
        <SearchIcon />
      </Button>
    </>
  );
}

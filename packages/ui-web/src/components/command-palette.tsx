'use client';

import { SearchIcon } from 'lucide-react';
import * as React from 'react';
import { moveActive } from '../lib/command.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog.js';
import { Kbd } from './kbd.js';
import { Spinner } from './spinner.js';

export interface CommandEntry {
  readonly id: string;
  readonly label: string;
  /** A short muted line beside the label ("Surat · 14 Nov"). */
  readonly description?: string;
  readonly icon?: React.ReactNode;
  readonly onSelect: () => void;
}

export interface CommandGroupData {
  readonly heading: string;
  readonly items: ReadonlyArray<CommandEntry>;
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  /** Already filtered for `query` by the app; empty groups are skipped. */
  readonly groups: ReadonlyArray<CommandGroupData>;
  readonly placeholder?: string;
  /** A search is in flight: a spinner replaces the search icon. */
  readonly loading?: boolean;
  /** Shown when no group has a row. */
  readonly empty?: React.ReactNode;
  /** One line under the list, announced politely ("Type 2 letters to search bookings"). */
  readonly status?: React.ReactNode;
  /** The dialog's accessible name. */
  readonly title?: string;
}

/**
 * ⌘K / Ctrl+K (ADR-0026 D8): a search box over grouped commands, built on the kit's Radix
 * Dialog (no cmdk). WAI-ARIA combobox + listbox: the focus stays in the input, ↑/↓ move the
 * active row (wrapping), Enter runs it, Esc closes; the pointer can pick too. Choosing a row
 * runs it and closes the palette.
 */
function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  groups,
  placeholder = 'Search…',
  loading = false,
  empty = 'Nothing matches that.',
  status,
  title = 'Search the panel',
}: CommandPaletteProps) {
  const base = React.useId();
  const listId = `${base}-list`;
  const visible = groups.filter((g) => g.items.length > 0);
  const flat = visible.flatMap((g) => g.items);
  const signature = flat.map((i) => i.id).join('|');
  const [active, setActive] = React.useState(0);

  // A new result set starts at its first row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting on a new result set is the point
  React.useEffect(() => setActive(flat.length > 0 ? 0 : -1), [signature]);

  const optionId = (index: number) => `${base}-option-${index}`;
  // Keep the active row in view as the arrows move it.
  React.useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${base}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, base]);

  const run = (entry: CommandEntry | undefined) => {
    if (!entry) return;
    onOpenChange(false);
    entry.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => moveActive(i, e.key === 'ArrowDown' ? 1 : -1, flat.length));
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run(flat[active]);
    }
  };

  let index = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-4 max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:top-24 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search. Use the up and down arrows to move, Enter to open, Escape to close.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b px-4">
          {loading ? (
            <Spinner className="text-muted-foreground" />
          ) : (
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 && flat[active] ? optionId(active) : undefined}
            aria-label={title}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            placeholder={placeholder}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-subtle"
          />
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        </div>
        <div id={listId} role="listbox" aria-label={title} className="max-h-96 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-muted-foreground text-sm">{empty}</p>
          ) : (
            visible.map((group) => (
              // biome-ignore lint/a11y/useSemanticElements: a listbox groups its options with role="group" (WAI-ARIA), not a fieldset
              <div key={group.heading} role="group" aria-label={group.heading} className="pb-2">
                <div
                  aria-hidden="true"
                  className="px-3 pt-2 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-micro"
                >
                  {group.heading}
                </div>
                {group.items.map((entry) => {
                  index += 1;
                  const mine = index;
                  const selected = mine === active;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the keys live on the combobox input (aria-activedescendant); the pointer picks here
                    <div
                      key={entry.id}
                      id={optionId(mine)}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      data-active={selected}
                      onMouseMove={() => (selected ? undefined : setActive(mine))}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => run(entry)}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-foreground text-sm data-[active=true]:bg-accent data-[active=true]:text-accent-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                    >
                      {entry.icon}
                      <span className="min-w-0 flex-1 truncate font-medium">{entry.label}</span>
                      {entry.description ? (
                        <span className="hidden truncate text-muted-foreground sm:inline">
                          {entry.description}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t bg-muted px-4 py-2 text-muted-foreground text-xs">
          <span aria-live="polite" className="truncate">
            {status}
          </span>
          <span aria-hidden="true" className="hidden shrink-0 items-center gap-3 sm:flex">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> open
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { CommandPalette };

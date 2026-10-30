import type * as React from 'react';
import { cn } from '../lib/cn.js';

/**
 * A kanban board (ADR-0026 D8: onboarding). Columns scroll sideways on a laptop, each with its
 * title and live count; cards are buttons (keyboard and screen-reader friendly). Moving a card is
 * an explicit action with a reason — never drag-and-drop — so every move can be audited.
 */
function KanbanBoard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="kanban-board"
      className={cn('flex gap-4 overflow-x-auto pb-4', className)}
      {...props}
    />
  );
}

export interface KanbanColumnProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  readonly title: React.ReactNode;
  readonly count: number;
  /** Shown when the column has no cards. */
  readonly emptyText?: React.ReactNode;
  /** A count above the cards shown ("100 of 140"). */
  readonly shown?: number;
}

function KanbanColumn({
  title,
  count,
  emptyText = 'Nothing here',
  shown,
  className,
  children,
  ...props
}: KanbanColumnProps) {
  const hasCards = count > 0;
  return (
    <section
      data-slot="kanban-column"
      className={cn('flex w-72 shrink-0 flex-col gap-3 rounded-lg border bg-muted p-3', className)}
      {...props}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-card px-1.5 font-semibold text-xs tabular-nums">
          {count}
        </span>
      </header>
      {shown !== undefined && shown < count ? (
        <p className="px-1 text-muted-foreground text-xs">
          Showing the {shown} waiting longest of {count}
        </p>
      ) : null}
      {hasCards ? (
        <ul className="grid gap-2">{children}</ul>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-muted-foreground text-sm">
          {emptyText}
        </p>
      )}
    </section>
  );
}

export interface KanbanCardProps extends React.ComponentProps<'button'> {
  readonly selected?: boolean;
}

function KanbanCard({ selected = false, className, ...props }: KanbanCardProps) {
  return (
    <li>
      <button
        type="button"
        data-slot="kanban-card"
        aria-pressed={selected}
        className={cn(
          'grid w-full cursor-pointer gap-1 rounded-md border bg-card p-3 text-left shadow-xs outline-none transition-[color,box-shadow] hover:border-ring focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          selected && 'border-ring ring-[3px] ring-ring/50',
          className,
        )}
        {...props}
      />
    </li>
  );
}

export { KanbanBoard, KanbanCard, KanbanColumn };

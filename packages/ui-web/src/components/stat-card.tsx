import { cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.js';

export type StatTone = 'neutral' | 'attention' | 'urgent';

/**
 * Tone is a gentle tint, a border and a dot — never colour alone (the hint says why) and never
 * tone-coloured text (theme.test.ts). Interactive cards (`asChild` with a link) lift on hover
 * and show the focus ring.
 */
const statCardVariants = cva(
  'group/stat relative flex min-w-0 flex-col gap-2 rounded-lg border p-4 text-card-foreground shadow-sm outline-none transition-[box-shadow,border-color] focus-visible:ring-[3px] focus-visible:ring-ring/50 [a&]:hover:border-input [a&]:hover:shadow-md',
  {
    variants: {
      tone: {
        neutral: 'bg-card',
        attention: 'border-warning/40 bg-warning/10',
        urgent: 'border-destructive/40 bg-destructive/10',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const dotTone: Readonly<Record<StatTone, string>> = {
  neutral: 'hidden',
  attention: 'bg-warning',
  urgent: 'bg-destructive',
};

export interface StatCardProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  /** One plain line under the number: what is counted. */
  readonly hint?: React.ReactNode;
  readonly icon?: React.ReactNode;
  readonly tone?: StatTone;
  /**
   * Render as the single child (a router `<Link>`): the card's content goes inside it, so the
   * whole tile is one link and one tab stop.
   */
  readonly asChild?: boolean;
}

/** A number tile (ADR-0026 D8): label, the number in display type, and a one-line hint. */
function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  asChild = false,
  className,
  children,
  ...props
}: StatCardProps) {
  const Comp = asChild ? Slot.Root : 'div';
  return (
    <Comp
      data-slot="stat-card"
      data-tone={tone}
      className={cn(statCardVariants({ tone }), className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 font-medium text-muted-foreground text-sm">
          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dotTone[tone])} />
          <span className="truncate">{label}</span>
        </span>
        {icon ? (
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <span className="font-bold font-display text-3xl tabular-nums">{value}</span>
      {hint ? <span className="line-clamp-2 text-muted-foreground text-sm">{hint}</span> : null}
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : children}
    </Comp>
  );
}

/** The row the tiles sit in: two across on a phone, three on a tablet, four on a laptop. */
function StatGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="stat-grid"
      className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4', className)}
      {...props}
    />
  );
}

export { StatCard, StatGrid, statCardVariants };

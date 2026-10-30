import { cva } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../lib/cn.js';

/** Past this, a count reads "99+": the exact number lives on the desk. */
export const COUNT_BADGE_MAX = 99;

/** "3", "99+", or "100+" when the server stopped counting at its cap. */
export function countLabel(count: number, capped = false): string {
  if (count > COUNT_BADGE_MAX) return `${COUNT_BADGE_MAX}+`;
  return capped ? `${count}+` : String(count);
}

export type CountTone = 'neutral' | 'attention' | 'urgent';

/**
 * Neutral is a quiet grey pill; attention a warning tint; urgent a solid red pill with white
 * text (AA, theme.test.ts). The text stays `foreground` on tints. Never amber: amber is the one
 * primary action on screen (DESIGN.md).
 */
const countBadgeVariants = cva(
  'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border px-1.5 font-semibold text-xs tabular-nums leading-none',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-foreground',
        attention: 'border-warning/30 bg-warning/10 text-foreground',
        urgent: 'border-transparent bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface CountBadgeProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  readonly count: number;
  readonly capped?: boolean;
  readonly tone?: CountTone;
  /** What is counted, for screen readers: "waiting" → "3 waiting". */
  readonly label?: string;
}

/** A live count beside a nav item or a heading (ADR-0026 D8). Renders nothing at zero. */
function CountBadge({ count, capped = false, tone, label, className, ...props }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      data-slot="count-badge"
      className={cn(countBadgeVariants({ tone }), className)}
      {...props}
    >
      {countLabel(count, capped)}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}

export { CountBadge, countBadgeVariants };

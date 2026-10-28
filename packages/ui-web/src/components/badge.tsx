import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../lib/cn.js';

/**
 * Status badge: a pill in micro type on a tinted background (DESIGN.md §Components). The tone
 * shows in the tint, the border and a dot; the label stays `foreground` because tone-coloured
 * text on its own tint falls below AA (theme.test.ts). Meaning is never colour alone: a badge
 * always carries its label.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-xs uppercase tracking-micro [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted text-muted-foreground',
        primary: 'border-transparent bg-primary text-primary-foreground',
        success: 'border-success/30 bg-success/10 text-foreground',
        warning: 'border-warning/30 bg-warning/10 text-foreground',
        destructive: 'border-destructive/30 bg-destructive/10 text-foreground',
        emergency: 'border-emergency/30 bg-emergency-subtle text-emergency',
        outline: 'border-border bg-card text-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

const dotVariants = cva('size-1.5 shrink-0 rounded-full', {
  variants: {
    variant: {
      neutral: 'bg-subtle',
      primary: 'bg-primary-foreground',
      success: 'bg-success',
      warning: 'bg-warning',
      destructive: 'bg-destructive',
      emergency: 'bg-emergency',
      outline: 'bg-subtle',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export interface BadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {
  /** A tone dot before the label. Default on for tones, off for outline/primary. */
  readonly dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  const showDot = dot ?? (variant !== 'outline' && variant !== 'primary');
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {showDot ? <span aria-hidden="true" className={dotVariants({ variant })} /> : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };

import type * as React from 'react';
import { cn } from '../lib/cn.js';

/**
 * DESIGN.md: an empty state always has an illustration slot and one action. ADR-0026 D8: it says
 * what is done ("All caught up") rather than only that a list is empty — `tone="success"` for a
 * queue that was cleared, `compact` inside a card.
 */
export interface EmptyStateProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  readonly icon?: React.ReactNode;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly tone?: 'neutral' | 'success';
  readonly size?: 'default' | 'compact';
}

const ICON_TONE = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 [&_svg]:text-success',
} as const;

function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  size = 'default',
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      data-tone={tone}
      className={cn(
        'flex flex-col items-center gap-3 text-center',
        size === 'compact' ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-full',
            size === 'compact' ? 'size-10 [&_svg]:size-5' : 'size-12 [&_svg]:size-6',
            ICON_TONE[tone],
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="grid max-w-md gap-1">
        <p className="font-semibold text-base">{title}</p>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export { EmptyState };

import type * as React from 'react';
import { cn } from '../lib/cn.js';

/**
 * The top of every desk (ADR-0026 D8): an optional eyebrow (a date, a back link), the title,
 * one line of description, and the actions on the right — the primary one last. On a phone the
 * actions wrap under the title.
 */
export interface PageHeaderProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly actions?: React.ReactNode;
  /** A small line above the title: "Fri, 30 Oct", or a back link. */
  readonly eyebrow?: React.ReactNode;
}

function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}
      {...props}
    >
      <div className="grid min-w-0 gap-1">
        {eyebrow ? <div className="text-muted-foreground text-sm">{eyebrow}</div> : null}
        <h1 className="text-balance font-bold font-display text-2xl">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SectionTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('font-semibold text-lg', className)} {...props} />;
}

/** A section inside a page: title (with an optional count), one line, and a link or action. */
function SectionHeader({
  title,
  description,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
}) {
  return (
    <div
      data-slot="section-header"
      className={cn('mb-3 flex items-end justify-between gap-3', className)}
      {...props}
    >
      <div className="grid min-w-0 gap-0.5">
        <SectionTitle className="flex items-center gap-2">{title}</SectionTitle>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export { PageHeader, SectionHeader, SectionTitle };

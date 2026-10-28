import type * as React from 'react';
import { cn } from '../lib/cn.js';

export interface PageHeaderProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly actions?: React.ReactNode;
}

function PageHeader({ title, description, actions, className, ...props }: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn('mb-6 flex flex-wrap items-start justify-between gap-4', className)}
      {...props}
    >
      <div className="grid min-w-0 gap-1">
        <h1 className="font-bold font-display text-2xl">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SectionTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('font-semibold text-lg', className)} {...props} />;
}

export { PageHeader, SectionTitle };

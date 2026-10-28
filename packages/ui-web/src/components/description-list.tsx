import type * as React from 'react';
import { cn } from '../lib/cn.js';

function DescriptionList({ className, ...props }: React.ComponentProps<'dl'>) {
  return (
    <dl
      data-slot="description-list"
      className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}
      {...props}
    />
  );
}

function DescriptionItem({
  term,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { readonly term: React.ReactNode }) {
  return (
    <div data-slot="description-item" className={cn('grid gap-1', className)} {...props}>
      <dt className="font-medium text-muted-foreground text-xs uppercase tracking-micro">{term}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export { DescriptionItem, DescriptionList };

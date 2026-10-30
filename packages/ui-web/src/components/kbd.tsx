import type * as React from 'react';
import { cn } from '../lib/cn.js';

/** A keyboard key in a hint ("⌘ K", "Esc", "↵"). Decorative: pair it with words for readers. */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded-sm border bg-muted px-1 font-medium font-sans text-muted-foreground text-xs',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };

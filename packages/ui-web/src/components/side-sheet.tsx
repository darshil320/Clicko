'use client';

import type * as React from 'react';
import { cn } from '../lib/cn.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet.js';

const WIDTH = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
} as const;

export interface SideSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  /** The sheet's one primary action (and its cancel), pinned to the bottom. */
  readonly footer?: React.ReactNode;
  readonly size?: keyof typeof WIDTH;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * The quick-action pattern (ADR-0026 D8): a decision on a row opens over the list from the
 * right — title and one line of context on top, the form scrolling in the middle, the one
 * primary action pinned at the bottom — so the list stays put behind it. Full width on a phone.
 * A long record gets its own page instead.
 */
function SideSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  children,
  className,
}: SideSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn('w-full gap-0 p-0', WIDTH[size], className)}>
        <SheetHeader className="border-b px-6 py-4 pr-12">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div
          data-slot="side-sheet-body"
          className="grid flex-1 content-start gap-4 overflow-y-auto px-6 py-5"
        >
          {children}
        </div>
        {footer ? (
          <div
            data-slot="side-sheet-footer"
            className="flex flex-col-reverse gap-2 border-t bg-card px-6 py-4 sm:flex-row sm:justify-end"
          >
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export { SideSheet };

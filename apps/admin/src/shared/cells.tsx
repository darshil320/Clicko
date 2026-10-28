'use client';

import { Badge } from '@clickco/ui-web';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatCode, formatDateTime, formatDue } from './format';

/** Small cell renderers shared by the desks' tables (compositions of ui-web only). */

export function BookingLink({
  id,
  reference,
}: {
  readonly id: string;
  readonly reference: string;
}) {
  return (
    <Link
      href={`/bookings/${id}`}
      className="font-semibold text-foreground underline-offset-4 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {reference}
    </Link>
  );
}

export function Muted({ children }: { readonly children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/** "14 Sep, 4:30 pm" with "in 2 h" / "25 min overdue" under it. */
export function DueCell({ at, now }: { readonly at: string | null; readonly now: number }) {
  if (!at) return <Muted>—</Muted>;
  const due = formatDue(at, now);
  return (
    <div className="grid gap-1">
      <span>{formatDateTime(at)}</span>
      {due.overdue ? (
        <Badge variant="destructive">{due.text}</Badge>
      ) : (
        <span className="text-muted-foreground text-sm">{due.text}</span>
      )}
    </div>
  );
}

export function CodeBadge({ code }: { readonly code: string }) {
  return <Badge variant="outline">{formatCode(code)}</Badge>;
}

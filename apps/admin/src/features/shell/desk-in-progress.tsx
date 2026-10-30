'use client';

import { EmptyState, WrenchIcon } from '@clickco/ui-web';

/** Placeholder for a Sprint 10 desk while it is built (ADR-0026 D9). Replaced by its stream. */
export function DeskInProgress({ title }: { readonly title: string }) {
  return (
    <EmptyState
      icon={<WrenchIcon />}
      title={title}
      description="This desk is being built this sprint."
    />
  );
}

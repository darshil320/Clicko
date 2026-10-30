'use client';

import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@clickco/ui-web';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BatchesTab } from './batches-tab';
import { DueTab } from './due-tab';
import { TdsTab } from './tds-tab';

type Tab = 'due' | 'batches' | 'tds';
const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'due', label: 'Due' },
  { value: 'batches', label: 'Batches' },
  { value: 'tds', label: 'TDS' },
];

/** Photographer payouts (ADR-0026 D3/D8): Due → batch → bank file → paid; TDS for the CA. */
export function PayoutsDesk() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('due');
  const open = (id: string) => router.push(`/payouts/batches/${id}`);

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Payouts"
        description="Pay photographers every Monday for jobs delivered at least 3 days ago. TDS and deductions are worked out for you."
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(TABS.find((t) => t.value === v)?.value ?? 'due')}
      >
        <TabsList aria-label="Payouts">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="due" className="pt-4">
          <DueTab onOpenBatch={open} />
        </TabsContent>
        <TabsContent value="batches" className="pt-4">
          <BatchesTab onOpenBatch={open} />
        </TabsContent>
        <TabsContent value="tds" className="pt-4">
          <TdsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

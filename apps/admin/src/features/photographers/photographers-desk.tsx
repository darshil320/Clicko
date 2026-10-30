'use client';

import { CountBadge, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { ApplicationsBoard } from './applications-board';
import { Directory } from './directory';
import { KycQueue } from './kyc-queue';
import { supplyKeys } from './labels';

type Tab = 'applications' | 'kyc' | 'directory';

/**
 * The photographers desk (ADR-0026 D5): onboarding as a kanban, the documents waiting to be
 * checked, and the directory of everyone on file.
 */
export function PhotographersDesk() {
  const [tab, setTab] = useState<Tab>('applications');
  const kyc = useQuery({ queryKey: supplyKeys.kyc, queryFn: () => adminApi.supply.kyc.list({}) });
  const kycCount = kyc.data?.items.length ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="Supply"
        title="Photographers"
        description="Bring new photographers on board, check their documents, and look after everyone already shooting."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Photographers desk">
          <TabsTrigger value="applications">Onboarding</TabsTrigger>
          <TabsTrigger value="kyc">
            Documents to check
            <CountBadge
              count={kycCount}
              capped={Boolean(kyc.data?.nextCursor)}
              tone="attention"
              label="waiting"
            />
          </TabsTrigger>
          <TabsTrigger value="directory">Directory</TabsTrigger>
        </TabsList>
        <TabsContent value="applications" className="pt-2">
          <ApplicationsBoard />
        </TabsContent>
        <TabsContent value="kyc" className="pt-2">
          <KycQueue />
        </TabsContent>
        <TabsContent value="directory" className="pt-2">
          <Directory />
        </TabsContent>
      </Tabs>
    </>
  );
}

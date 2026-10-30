'use client';

import type { AdminPricingRuleset, PricingRulesetSummary } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ArrowLeftIcon,
  Badge,
  Button,
  Card,
  CardContent,
  PageHeader,
  RelativeTime,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@clickco/ui-web';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { formatDateTime } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { FestivalsTable } from './festivals';
import { PreviewPanel } from './preview-panel';
import { PublishDialog } from './publish-dialog';
import {
  AddonsTable,
  BaseRatesTable,
  CategoriesTable,
  ExtensionsTable,
  OtherRulesTable,
} from './rate-tables';
import { ReviewSheet } from './review-sheet';
import {
  pricingKeys,
  useCanEditPricing,
  useDiff,
  useDraftEdit,
  usePricingOverview,
  useRuleset,
} from './use-pricing';

const STATE_BADGE: Readonly<
  Record<
    PricingRulesetSummary['state'],
    { label: string; variant: 'success' | 'warning' | 'neutral' }
  >
> = {
  LIVE: { label: 'Live', variant: 'success' },
  SCHEDULED: { label: 'Scheduled', variant: 'warning' },
  DRAFT: { label: 'Draft', variant: 'warning' },
  CLOSED: { label: 'Replaced', variant: 'neutral' },
  DISCARDED: { label: 'Discarded', variant: 'neutral' },
};

function title(s: PricingRulesetSummary): string {
  if (s.state === 'DRAFT' || s.state === 'DISCARDED') return s.label ?? 'Untitled draft';
  return `Version ${s.version ?? ''}`;
}

function subtitle(s: PricingRulesetSummary): string {
  switch (s.state) {
    case 'DRAFT':
      return `Copied from version ${s.basedOn?.version ?? '—'}. Changes save as you go; customers see nothing until you publish.`;
    case 'LIVE':
      return `Every new quote uses these prices, since ${formatDateTime(s.effectiveFrom ?? s.createdAt)}.`;
    case 'SCHEDULED':
      return `Goes live ${formatDateTime(s.effectiveFrom ?? s.createdAt)}.`;
    case 'CLOSED':
      return `Was live ${formatDateTime(s.effectiveFrom ?? s.createdAt)} – ${formatDateTime(s.effectiveTo ?? s.createdAt)}. Bookings made then keep these prices.`;
    case 'DISCARDED':
      return `Discarded ${formatDateTime(s.discardedAt ?? s.createdAt)}${s.discardedBy ? ` by ${s.discardedBy}` : ''}. Kept for the record.`;
  }
}

/**
 * One rate card. A draft is an editor (grouped tables with inline ₹ and % editing, a festival
 * sheet, the calculator beside it, "Review changes" as the one primary action); anything
 * published or discarded is read-only.
 */
export function RulesetPage({ rulesetId }: { readonly rulesetId: string }) {
  const ruleset = useRuleset(rulesetId);
  const canEdit = useCanEditPricing();

  if (ruleset.isLoading) return <Skeleton className="h-96 w-full" />;
  if (ruleset.error || !ruleset.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>This rate card could not load</AlertTitle>
        <AlertDescription>{describeError(ruleset.error).message}</AlertDescription>
      </Alert>
    );
  }
  return <Editor ruleset={ruleset.data} canEdit={canEdit} />;
}

function Editor({
  ruleset,
  canEdit,
}: {
  readonly ruleset: AdminPricingRuleset;
  readonly canEdit: boolean;
}) {
  const s = ruleset.summary;
  const isDraft = s.state === 'DRAFT';
  const editable = isDraft && canEdit;
  const router = useRouter();
  const edit = useDraftEdit(s.id);
  const diff = useDiff(s.id, s.state === 'DRAFT');
  const overview = usePricingOverview();
  const [reviewing, setReviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const changed = useMemo(() => new Set((diff.data?.rows ?? []).map((r) => r.key)), [diff.data]);
  const versions = useMemo(() => {
    const o = overview.data;
    return [o?.live, o?.scheduled, ...(o?.history ?? [])].flatMap((r) =>
      r?.version ? [r.version] : [],
    );
  }, [overview.data]);
  const discard = useAdminMutation({
    run: (_: null, idem) => adminApi.pricing.discard(s.id, idem),
    success: () => 'Draft discarded. It stays in the history.',
    invalidate: [pricingKeys.all],
    onSuccess: () => router.push('/pricing'),
  });

  const props = { ruleset, save: editable ? edit.save : null, changed };
  const badge = STATE_BADGE[s.state];

  return (
    <>
      <Button variant="ghost" asChild className="mb-2">
        <Link href="/pricing">
          <ArrowLeftIcon />
          Pricing
        </Link>
      </Button>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title(s)}
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </span>
        }
        description={subtitle(s)}
        actions={
          isDraft ? (
            <>
              {editable ? (
                <Button
                  variant="outline"
                  disabled={discard.isPending}
                  onClick={() => discard.mutate(null)}
                >
                  Discard draft
                </Button>
              ) : null}
              <Button onClick={() => setReviewing(true)}>
                Review changes
                {diff.data ? ` (${diff.data.rows.length})` : ''}
              </Button>
            </>
          ) : null
        }
      />
      {isDraft && diff.data?.liveChangedSinceCopy ? (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Live prices changed after this draft was started</AlertTitle>
          <AlertDescription>
            Review changes before publishing: this draft would undo them.
          </AlertDescription>
        </Alert>
      ) : null}
      {isDraft ? (
        <p className="mb-4 text-muted-foreground text-sm">
          Last edited <RelativeTime at={s.updatedAt} />
          {s.createdBy ? ` · started by ${s.createdBy}` : ''}. Click a price to change it; bold
          prices differ from live.
        </p>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="py-3">
          <CardContent>
            <Tabs defaultValue="rates">
              <TabsList aria-label="Rate card sections" className="flex-wrap">
                <TabsTrigger value="rates">Hourly rates</TabsTrigger>
                <TabsTrigger value="categories">Categories</TabsTrigger>
                <TabsTrigger value="addons">Add-ons</TabsTrigger>
                <TabsTrigger value="extensions">Extra time</TabsTrigger>
                <TabsTrigger value="festivals">Festival dates</TabsTrigger>
                <TabsTrigger value="other">Other rules</TabsTrigger>
              </TabsList>
              <TabsContent value="rates">
                <BaseRatesTable {...props} />
              </TabsContent>
              <TabsContent value="categories">
                <CategoriesTable {...props} />
              </TabsContent>
              <TabsContent value="addons">
                <AddonsTable {...props} />
              </TabsContent>
              <TabsContent value="extensions">
                <ExtensionsTable {...props} />
              </TabsContent>
              <TabsContent value="festivals">
                <FestivalsTable {...props} />
              </TabsContent>
              <TabsContent value="other">
                <OtherRulesTable ruleset={ruleset} />
              </TabsContent>
            </Tabs>
            <p className="mt-4 text-muted-foreground text-sm">
              Prices are {ruleset.pricesIncludeGst ? 'GST inclusive' : 'before GST'}; GST is{' '}
              {ruleset.gstRateBps / 100}% (SAC {ruleset.sacCode}).
            </p>
          </CardContent>
        </Card>
        <div className="xl:sticky xl:top-4 xl:self-start">
          <PreviewPanel ruleset={ruleset} />
        </div>
      </div>
      {isDraft ? (
        <ReviewSheet
          rulesetId={s.id}
          open={reviewing}
          onOpenChange={setReviewing}
          canPublish={editable}
          onPublish={() => {
            setReviewing(false);
            setPublishing(true);
          }}
        />
      ) : null}
      {publishing ? (
        <PublishDialog
          rulesetId={s.id}
          changeCount={diff.data?.rows.length ?? s.changeCount ?? 0}
          takenVersions={versions}
          reviewedAt={s.updatedAt}
          onClose={() => setPublishing(false)}
        />
      ) : null}
    </>
  );
}

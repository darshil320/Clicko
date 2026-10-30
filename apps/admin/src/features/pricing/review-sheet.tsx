'use client';

import type { PricingDiffRow, PricingDiffSection, PricingDiffValue } from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  SideSheet,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TriangleAlertIcon,
} from '@clickco/ui-web';
import { describeError } from '../../shared/errors';
import { formatMoney } from '../../shared/format';
import { bpsToFactor, changeOf } from './pricing-format';
import { useDiff } from './use-pricing';

const SECTION_TITLE: Readonly<Record<PricingDiffSection, string>> = {
  SETTINGS: 'GST',
  BASE_RATE: 'Hourly rates',
  CATEGORY_UPLIFT: 'Categories',
  ADDON_PRICE: 'Add-ons',
  EXTENSION_RATE: 'Extra hours and waiting',
  FESTIVAL: 'Festival dates',
  EMERGENCY: 'Short-notice bookings',
  TIME: 'Night and weekend',
  TRAVEL: 'Travel',
  DELIVERABLE: 'What each plan includes',
};

const CHANGE_LABEL = { ADDED: 'Added', REMOVED: 'Removed', CHANGED: 'Changed' } as const;

/** One cell as a person reads it: ₹, factor, yes/no. */
function show(value: PricingDiffValue, side: 'before' | 'after', field: string): string {
  const v = value[side];
  if (v === null) return '—';
  switch (value.unit) {
    case 'PAISE':
      return formatMoney(v as number);
    case 'BPS':
      return field === 'payoutShareBps' || field === 'gstRateBps'
        ? `${(v as number) / 100}%`
        : bpsToFactor(v as number);
    case 'BOOL':
      return v ? 'Yes' : 'No';
    default:
      return String(v);
  }
}

function Delta({ value }: { readonly value: PricingDiffValue }) {
  if (
    (value.unit !== 'PAISE' && value.unit !== 'BPS') ||
    value.before === null ||
    value.after === null
  ) {
    return null;
  }
  const c = changeOf(value.before, value.after);
  if (!c.percent) return null;
  return (
    <Badge variant={c.large ? 'warning' : 'neutral'} dot={c.large}>
      {c.percent}
    </Badge>
  );
}

/**
 * "Review changes" (doc 05 §11 diff view): only what differs from live, grouped, ₹ before →
 * after with the % change; changes of 25 % or more are flagged. The one action: publish.
 */
export function ReviewSheet({
  rulesetId,
  open,
  onOpenChange,
  onPublish,
  canPublish,
}: {
  readonly rulesetId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPublish: () => void;
  readonly canPublish: boolean;
}) {
  const diff = useDiff(rulesetId, open);
  const rows = diff.data?.rows ?? [];
  const sections = [...new Set(rows.map((r) => r.section))];
  const large = rows.filter((r) =>
    r.fields.some(
      (f) =>
        (f.value.unit === 'PAISE' || f.value.unit === 'BPS') &&
        f.value.before !== null &&
        f.value.after !== null &&
        changeOf(f.value.before, f.value.after).large,
    ),
  ).length;

  return (
    <SideSheet
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="Review changes"
      description={
        diff.data?.against
          ? `Compared with live version ${diff.data.against.version}. Only rows that change are listed.`
          : 'Nothing is live yet: every row is new.'
      }
      footer={
        canPublish ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Keep editing
            </Button>
            <Button onClick={onPublish} disabled={rows.length === 0}>
              Publish…
            </Button>
          </div>
        ) : null
      }
    >
      <div className="grid gap-5">
        {diff.isLoading ? <Skeleton className="h-40 w-full" /> : null}
        {diff.error ? (
          <p role="alert" className="text-destructive text-sm">
            {describeError(diff.error).message}
          </p>
        ) : null}
        {diff.data?.liveChangedSinceCopy ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Live prices changed after this draft was started</AlertTitle>
            <AlertDescription>
              This draft was copied from version {diff.data.ruleset.basedOn?.version}. Publishing it
              would also undo the newer changes listed below.
            </AlertDescription>
          </Alert>
        ) : null}
        {large > 0 ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>
              {large === 1 ? '1 price moves' : `${large} prices move`} by 25% or more
            </AlertTitle>
            <AlertDescription>Check these for typos before publishing.</AlertDescription>
          </Alert>
        ) : null}
        {diff.data && rows.length === 0 ? (
          <EmptyState title="No changes yet" description="This draft matches the live rate card." />
        ) : null}
        {sections.map((section) => (
          <section key={section} className="grid gap-2">
            <h3 className="font-semibold">{SECTION_TITLE[section]}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>What</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>
                    <span className="sr-only">Change</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows
                  .filter((r) => r.section === section)
                  .flatMap((r: PricingDiffRow) =>
                    r.fields.map((f, i) => (
                      <TableRow key={`${r.key}:${r.change}:${f.field}`}>
                        <TableCell className="whitespace-normal font-medium">
                          {i === 0 ? (
                            <span className="grid gap-1">
                              {r.label}
                              {r.change !== 'CHANGED' ? (
                                <Badge variant="outline">{CHANGE_LABEL[r.change]}</Badge>
                              ) : null}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{f.label}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {show(f.value, 'before', f.field)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {show(f.value, 'after', f.field)}
                        </TableCell>
                        <TableCell>
                          <Delta value={f.value} />
                        </TableCell>
                      </TableRow>
                    )),
                  )}
              </TableBody>
            </Table>
          </section>
        ))}
      </div>
    </SideSheet>
  );
}

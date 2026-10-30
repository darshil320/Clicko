'use client';

import {
  type AdminPenalty,
  type AdminPhotographerProfile,
  AdminPhotographerStatusBody,
  AdminWaivePenaltyBody,
  type PhotographerStatusAction,
  SUPPLY_ACTION_ROLES,
  statusActionsFrom,
} from '@clickco/contracts';
import {
  ArrowLeftIcon,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  PageHeader,
  Skeleton,
  StatCard,
  StatGrid,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { describeError } from '../../shared/errors';
import { formatBps, formatCode, formatDate, formatDay, formatPhone } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { useCan } from '../../shared/use-can';
import {
  ACTION_LABEL,
  DOC_LABEL,
  DOC_STATUS,
  PENALTY_LABEL,
  PRO_STATUS,
  SEVERITY_LABEL,
  statusConsequence,
  supplyKeys,
} from './labels';
import { VerificationList } from './verification-list';

/** A photographer's record (ADR-0026 D5): a long record, so its own page. */
export function PhotographerProfilePage({ photographerId }: { readonly photographerId: string }) {
  const query = useQuery({
    queryKey: supplyKeys.profile(photographerId),
    queryFn: () => adminApi.supply.photographers.get(photographerId),
  });
  const p = query.data;
  const canChange = useCan(SUPPLY_ACTION_ROLES.changeStatus);
  const [action, setAction] = useState<PhotographerStatusAction | null>(null);

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError || !p) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {describeError(query.error).message}
      </p>
    );
  }
  const actions = canChange(p.cityId) ? statusActionsFrom(p.status) : [];

  return (
    <div className="grid gap-8">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/photographers">
            <ArrowLeftIcon />
            Photographers
          </Link>
        </Button>
      </div>
      <PageHeader
        eyebrow={`${p.cityName} · up to ${formatCode(p.maxTier)}`}
        title={p.fullName}
        description={`${formatPhone(p.phone)}${p.email ? ` · ${p.email}` : ''}`}
        actions={
          <>
            <Badge variant={PRO_STATUS[p.status].tone}>{PRO_STATUS[p.status].label}</Badge>
            {actions.map((a) => (
              <Button key={a} variant="outline" onClick={() => setAction(a)}>
                {ACTION_LABEL[a]}
              </Button>
            ))}
          </>
        }
      />
      {p.status === 'SUSPENDED' && p.suspensionReason ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
          Suspended {p.suspendedAt ? formatDate(p.suspendedAt) : ''}: {p.suspensionReason}
        </p>
      ) : null}
      <StatGrid>
        <StatCard label="Shoots done" value={p.metrics?.shootsCompleted ?? p.shootsCompleted} />
        <StatCard
          label="Rating"
          value={p.metrics?.ratingAvgBps ? `★ ${(p.metrics.ratingAvgBps / 1000).toFixed(2)}` : '—'}
          hint={p.metrics ? `${p.metrics.ratingCount} reviews` : 'No reviews yet'}
        />
        <StatCard
          label="Accepts offers"
          value={
            p.metrics?.acceptanceRateBps != null ? formatBps(p.metrics.acceptanceRateBps) : '—'
          }
        />
        <StatCard
          label="Active penalties"
          value={p.activePenalties}
          tone={p.activePenalties > 0 ? 'attention' : 'neutral'}
          hint={p.metrics ? `${p.metrics.noShowCount} no-shows in total` : undefined}
        />
      </StatGrid>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Verification</CardTitle>
          </CardHeader>
          <CardContent>
            <VerificationList v={p.verification} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Work</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList>
              <DescriptionItem term="Categories">
                {p.categories.length === 0
                  ? 'None certified'
                  : p.categories
                      .map((c) => `${c.name} (to ${formatCode(c.certifiedTier)})`)
                      .join(', ')}
              </DescriptionItem>
              <DescriptionItem term="Travels up to">{p.serviceRadiusKm} km</DescriptionItem>
              <DescriptionItem term="Emergency shoots">
                {p.acceptsEmergency ? 'Yes' : 'No'}
              </DescriptionItem>
              <DescriptionItem term="Outstation">
                {p.acceptsOutstation ? 'Yes' : 'No'}
              </DescriptionItem>
              <DescriptionItem term="Onboarded">
                {p.onboardedAt ? formatDate(p.onboardedAt) : '—'}
              </DescriptionItem>
              <DescriptionItem term="GST">
                {p.verification.gstRegistered ? 'Registered' : 'Not registered'}
              </DescriptionItem>
            </DescriptionList>
          </CardContent>
        </Card>
      </div>
      <Penalties profile={p} />
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {p.documents.length === 0 ? (
            <p className="text-muted-foreground text-sm">No documents on file.</p>
          ) : (
            <ul className="grid gap-2">
              {p.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {DOC_LABEL[d.kind]}
                    {d.referenceMasked ? (
                      <span className="text-muted-foreground"> {d.referenceMasked}</span>
                    ) : null}
                    {d.expiresOn ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · valid to {formatDay(d.expiresOn)}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant={DOC_STATUS[d.reviewStatus].tone}>
                    {DOC_STATUS[d.reviewStatus].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {action ? <StatusDialog profile={p} action={action} onClose={() => setAction(null)} /> : null}
    </div>
  );
}

function Penalties({ profile: p }: { readonly profile: AdminPhotographerProfile }) {
  const canWaive = useCan(SUPPLY_ACTION_ROLES.waivePenalty)(p.cityId);
  const [waiving, setWaiving] = useState<AdminPenalty | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Penalties</CardTitle>
      </CardHeader>
      <CardContent>
        {p.penalties.length === 0 ? (
          <p className="text-muted-foreground text-sm">A clean record.</p>
        ) : (
          <ul className="grid gap-3">
            {p.penalties.map((x) => (
              <li
                key={x.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b pb-3 text-sm last:border-b-0"
              >
                <span className="grid gap-0.5">
                  <span className="font-medium">
                    {PENALTY_LABEL[x.kind] ?? formatCode(x.kind)} ·{' '}
                    {SEVERITY_LABEL[x.severity] ?? ''}
                    {x.deactivationDays ? ` (${x.deactivationDays} days)` : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(x.createdAt)}
                    {x.bookingReference ? ` · ${x.bookingReference}` : ''}
                    {x.note ? ` · ${x.note}` : ''}
                  </span>
                  {x.waived ? (
                    <span className="text-muted-foreground">Waived: {x.waiveReason}</span>
                  ) : null}
                </span>
                {x.waived ? (
                  <Badge variant="neutral">Waived</Badge>
                ) : canWaive ? (
                  <Button size="sm" variant="outline" onClick={() => setWaiving(x)}>
                    Waive…
                  </Button>
                ) : (
                  <Badge variant="warning">Active</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {waiving ? (
        <WaiveDialog profile={p} penalty={waiving} onClose={() => setWaiving(null)} />
      ) : null}
    </Card>
  );
}

function WaiveDialog({
  profile: p,
  penalty,
  onClose,
}: {
  readonly profile: AdminPhotographerProfile;
  readonly penalty: AdminPenalty;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminWaivePenaltyBody.safeParse({ reason });
  const waive = useAdminMutation({
    run: (vars: AdminWaivePenaltyBody, idem) =>
      adminApi.supply.penalties.waive(penalty.id, vars, idem),
    success: () => `Penalty waived for ${p.fullName}`,
    invalidate: [['supply']],
    onSuccess: onClose,
  });
  const kind = PENALTY_LABEL[penalty.kind] ?? formatCode(penalty.kind);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Waive ${p.fullName}'s ${kind.toLowerCase()} penalty?`}
      consequence={`It stops counting towards their next penalty and no payout deduction is taken for it${penalty.payoutDeductionBps > 0 ? ` (${formatBps(penalty.payoutDeductionBps)})` : ''}. This cannot be undone.`}
      confirmLabel="Waive penalty"
      pending={waive.isPending}
      onConfirm={() => {
        setTouched(true);
        if (check.success) waive.mutate(check.data);
      }}
    >
      <NoteField
        id="waive-reason"
        label="Reason"
        required
        hint="For example: verified medical emergency, or a late offline check-in."
        value={reason}
        onChange={setReason}
        error={touched ? fieldError(check, 'reason') : null}
      />
    </ConfirmDialog>
  );
}

function StatusDialog({
  profile: p,
  action,
  onClose,
}: {
  readonly profile: AdminPhotographerProfile;
  readonly action: PhotographerStatusAction;
  readonly onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminPhotographerStatusBody.safeParse({ action, reason });
  const change = useAdminMutation({
    run: (vars: AdminPhotographerStatusBody, idem) =>
      adminApi.supply.photographers.changeStatus(p.id, vars, idem),
    success: (_, updated) =>
      `${p.fullName} is now ${PRO_STATUS[updated.status].label.toLowerCase()}`,
    invalidate: [['supply']],
    onSuccess: onClose,
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`${ACTION_LABEL[action]} ${p.fullName}?`}
      consequence={statusConsequence(action, p.fullName)}
      confirmLabel={ACTION_LABEL[action]}
      destructive={action === 'SUSPEND' || action === 'OFFBOARD'}
      pending={change.isPending}
      onConfirm={() => {
        setTouched(true);
        if (check.success) change.mutate(check.data);
      }}
    >
      <NoteField
        id="status-reason"
        label="Reason"
        required
        value={reason}
        onChange={setReason}
        error={touched ? fieldError(check, 'reason') : null}
      />
    </ConfirmDialog>
  );
}

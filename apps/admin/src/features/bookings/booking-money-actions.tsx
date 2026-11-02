'use client';

import type { AdminBookingDetail, AdminBookingMoney, StaffGrant } from '@clickco/contracts';
import {
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  Separator,
  Skeleton,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { describeError } from '../../shared/errors';
import { formatDate, formatDateTime } from '../../shared/format';
import {
  CREDIT_REASON_LABEL,
  formatRupees,
  REFUND_REASON_LABEL,
  REFUND_STATUS,
} from '../../shared/money-labels';
import { bookingMoneyKey } from './booking-money-keys';
import { IssueCreditSheet } from './issue-credit-sheet';
import { creditBlocked, type MoneyAccess, moneyAccess, refundBlocked } from './money-actions';
import { RefundRequestSheet } from './refund-request-sheet';
import { Empty, Section } from './section';

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId'>>;

/**
 * Refunds and credits on the booking page (ADR-0027 D5): what went back, and the Refund and
 * Issue credit actions. Shown only to people who could ask for a refund in the booking's city
 * (the money endpoint refuses everyone else); Issue credit only to the QM, finance and super admin.
 */
export function BookingMoneyActions({
  booking,
  grants,
}: {
  readonly booking: AdminBookingDetail;
  readonly grants: Grants;
}) {
  const access = moneyAccess(grants, booking.cityId);
  if (!access.refund) return null;
  return <MoneySection bookingId={booking.id} access={access} />;
}

function MoneySection({
  bookingId,
  access,
}: {
  readonly bookingId: string;
  readonly access: MoneyAccess;
}) {
  const [open, setOpen] = useState<'refund' | 'credit' | null>(null);
  const query = useQuery({
    queryKey: bookingMoneyKey(bookingId),
    queryFn: () => adminApi.money.bookingMoney(bookingId),
  });
  const money = query.data;
  const noRefund = money ? refundBlocked(money) : null;
  const noCredit = money ? creditBlocked(money, access.unlimited) : null;

  return (
    <Section
      title="Refunds and credits"
      description="Asking for a refund needs a second person to approve it. Credits are issued at once."
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!money || noRefund !== null}
            onClick={() => setOpen('refund')}
          >
            Refund
          </Button>
          {access.credit ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!money || noCredit !== null}
              onClick={() => setOpen('credit')}
            >
              Issue credit
            </Button>
          ) : null}
        </div>
      }
    >
      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Empty>{describeError(query.error).message}</Empty>
      ) : money ? (
        <MoneyBody money={money} reasons={[noRefund, access.credit ? noCredit : null]} />
      ) : null}
      {money && open === 'refund' ? (
        <RefundRequestSheet money={money} onClose={() => setOpen(null)} />
      ) : null}
      {money && open === 'credit' ? (
        <IssueCreditSheet
          money={money}
          unlimited={access.unlimited}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </Section>
  );
}

function MoneyBody({
  money,
  reasons,
}: {
  readonly money: AdminBookingMoney;
  readonly reasons: ReadonlyArray<string | null>;
}) {
  const why = [...new Set(reasons.filter((r): r is string => r !== null))];
  return (
    <div className="grid gap-4">
      <DescriptionList>
        <DescriptionItem term="Paid">{formatRupees(money.paidPaise)}</DescriptionItem>
        <DescriptionItem term="Refunded">{formatRupees(money.refundedPaise)}</DescriptionItem>
        <DescriptionItem term="On its way back">
          {formatRupees(money.inFlightPaise)}
        </DescriptionItem>
        <DescriptionItem term="Can still refund">
          {formatRupees(money.refundablePaise)}
        </DescriptionItem>
        <DescriptionItem term="Credits issued">{formatRupees(money.creditedPaise)}</DescriptionItem>
        <DescriptionItem term="Quality Manager's limit">
          {formatRupees(money.qmLimitPaise)}
        </DescriptionItem>
      </DescriptionList>
      {why.map((w) => (
        <Muted key={w}>{w}</Muted>
      ))}
      {money.refunds.length > 0 || money.credits.length > 0 ? <Separator /> : null}
      {money.refunds.length > 0 ? (
        <ul className="grid gap-2">
          {money.refunds.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>
              <span className="font-medium">Refund {formatRupees(r.amountPaise)}</span>
              <span>{REFUND_REASON_LABEL[r.reason]}</span>
              <Muted>
                {r.requestedBy.name}, {formatDateTime(r.requestedAt)}
              </Muted>
            </li>
          ))}
        </ul>
      ) : null}
      {money.credits.length > 0 ? (
        <ul className="grid gap-2">
          {money.credits.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="neutral">Credit</Badge>
              <span className="font-medium">{formatRupees(c.amountPaise)}</span>
              <span>{CREDIT_REASON_LABEL[c.reason]}</span>
              <Muted>
                {c.issuedBy.name}, {formatDateTime(c.issuedAt)} · valid to {formatDate(c.expiresAt)}
              </Muted>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

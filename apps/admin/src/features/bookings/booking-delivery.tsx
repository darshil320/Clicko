import type { AdminBookingDetail } from '@clickco/contracts';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clickco/ui-web';
import Link from 'next/link';
import { Muted } from '../../shared/cells';
import {
  formatBps,
  formatCode,
  formatDateTime,
  formatMinutes,
  formatMoney,
} from '../../shared/format';
import { clockTone, qaTone } from '../../shared/tones';
import { Empty, Section } from './section';

/** QA, the SLA clocks and their breaches (ADR-0016). */
export function BookingDelivery({
  booking,
  canDecideQa,
  canDecideBreaches,
}: {
  readonly booking: AdminBookingDetail;
  readonly canDecideQa: boolean;
  readonly canDecideBreaches: boolean;
}) {
  return (
    <div className="grid gap-4">
      <Section
        title="QA"
        action={
          booking.qaStatus === 'PENDING' && canDecideQa ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/qa">Open the QA desk</Link>
            </Button>
          ) : null
        }
      >
        {booking.qaStatus ? (
          <Badge variant={qaTone(booking.qaStatus)}>{formatCode(booking.qaStatus)}</Badge>
        ) : (
          <Empty>No delivery to check yet.</Empty>
        )}
      </Section>
      <Section
        title="SLA clocks"
        description="Effective due adds the time spent waiting for the client’s payment."
      >
        {booking.slaClocks.length === 0 ? (
          <Empty>No clocks armed.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clock</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Effective due</TableHead>
                <TableHead>Met · breached</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {booking.slaClocks.map((clock) => (
                <TableRow key={`${clock.kind}-${clock.dueAt}`}>
                  <TableCell>{formatCode(clock.kind)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Badge variant={clockTone(clock.state)}>{formatCode(clock.state)}</Badge>
                      {clock.paused ? <Badge variant="neutral">Paused</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{formatDateTime(clock.dueAt)}</TableCell>
                  <TableCell>{formatDateTime(clock.effectiveDueAt)}</TableCell>
                  <TableCell>
                    {clock.metAt ? (
                      formatDateTime(clock.metAt)
                    ) : clock.breachedAt ? (
                      formatDateTime(clock.breachedAt)
                    ) : (
                      <Muted>—</Muted>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
      <Section
        title="Breaches"
        description="Shown for reference: remedies are not applied from the panel yet."
        action={
          booking.breaches.some((b) => !b.applied) && canDecideBreaches ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/breaches">Open the breach board</Link>
            </Button>
          ) : null
        }
      >
        {booking.breaches.length === 0 ? (
          <Empty>No SLA breaches.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clock</TableHead>
                <TableHead>Late by</TableHead>
                <TableHead>Remedy</TableHead>
                <TableHead>Payout deduction</TableHead>
                <TableHead>Attributed to</TableHead>
                <TableHead>Applied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {booking.breaches.map((breach) => (
                <TableRow key={breach.id}>
                  <TableCell>{formatCode(breach.kind)}</TableCell>
                  <TableCell>{formatMinutes(breach.delayMinutes)}</TableCell>
                  <TableCell>
                    {formatCode(breach.remedyKind)} · {formatMoney(breach.remedyPaise, true)}
                  </TableCell>
                  <TableCell>{formatBps(breach.payoutDeductionBps)}</TableCell>
                  <TableCell>{formatCode(breach.attributedTo)}</TableCell>
                  <TableCell>
                    <Badge variant={breach.applied ? 'success' : 'neutral'}>
                      {breach.applied ? 'Applied' : 'Not applied'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}

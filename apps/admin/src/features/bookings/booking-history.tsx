import type { AdminBookingDetail } from '@clickco/contracts';
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clickco/ui-web';
import { Muted } from '../../shared/cells';
import { formatCode, formatDateTime, formatMoney } from '../../shared/format';
import { bookingTone } from '../../shared/tones';
import { Empty, Section } from './section';

/** The status timeline and the payments (ADR-0025 D5). */
export function BookingHistory({ booking }: { readonly booking: AdminBookingDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Status timeline">
        {booking.timeline.length === 0 ? (
          <Empty>No status changes yet.</Empty>
        ) : (
          <ol className="grid gap-3">
            {booking.timeline.map((event, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: the timeline is append-only and ordered
                key={i}
                className="grid gap-1 border-l-2 border-border pl-3"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {event.fromStatus ? (
                    <>
                      <Badge variant={bookingTone(event.fromStatus)}>
                        {formatCode(event.fromStatus)}
                      </Badge>
                      <span aria-hidden="true" className="text-muted-foreground">
                        →
                      </span>
                      <span className="sr-only">to</span>
                    </>
                  ) : null}
                  <Badge variant={bookingTone(event.toStatus)}>{formatCode(event.toStatus)}</Badge>
                </div>
                <span className="text-muted-foreground text-sm">
                  {formatDateTime(event.occurredAt)} · by {formatCode(event.actorKind)}
                  {event.reason ? ` · ${formatCode(event.reason)}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Payments">
        {booking.payments.length === 0 ? (
          <Empty>No payments yet.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {booking.payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{formatCode(payment.kind)}</TableCell>
                  <TableCell>
                    <Badge variant={payment.status === 'CAPTURED' ? 'success' : 'neutral'}>
                      {formatCode(payment.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(payment.amountPaise, true)}
                  </TableCell>
                  <TableCell>
                    <Muted>{formatDateTime(payment.createdAt)}</Muted>
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

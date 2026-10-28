import type { AdminBookingDetail } from '@clickco/contracts';
import {
  Badge,
  DescriptionItem,
  DescriptionList,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@clickco/ui-web';
import { Muted } from '../../shared/cells';
import {
  formatCode,
  formatDateTime,
  formatMinutes,
  formatMoney,
  formatPhone,
} from '../../shared/format';
import { Empty, Section } from './section';

/** The photographer's assignment and its on-site events (ADR-0013). */
export function BookingAssignment({ booking }: { readonly booking: AdminBookingDetail }) {
  const a = booking.assignment;
  if (!a) {
    return (
      <Section title="Assignment">
        <Empty>No photographer has accepted this booking.</Empty>
      </Section>
    );
  }
  return (
    <Section title="Assignment" action={<Badge variant="outline">{formatCode(a.status)}</Badge>}>
      <div className="grid gap-5">
        <DescriptionList className="lg:grid-cols-4">
          <DescriptionItem term="Photographer">{a.photographerName}</DescriptionItem>
          <DescriptionItem term="Phone">{formatPhone(a.photographerPhone)}</DescriptionItem>
          <DescriptionItem term="Accepted">{formatDateTime(a.acceptedAt)}</DescriptionItem>
          <DescriptionItem term="Checked in · out">
            {a.checkedInAt ? formatDateTime(a.checkedInAt) : <Muted>Not yet</Muted>}
            {' · '}
            {a.checkedOutAt ? formatDateTime(a.checkedOutAt) : <Muted>not yet</Muted>}
          </DescriptionItem>
        </DescriptionList>
        {a.events.length === 0 ? (
          <Empty>No on-site events.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.events.map((event) => (
                <TableRow key={event.eventId}>
                  <TableCell>{formatCode(event.kind)}</TableCell>
                  <TableCell>{formatCode(event.actorKind)}</TableCell>
                  <TableCell>
                    {event.minutes === null ? <Muted>—</Muted> : formatMinutes(event.minutes)}
                  </TableCell>
                  <TableCell className="text-right">
                    {event.amountPaise === null ? (
                      <Muted>—</Muted>
                    ) : (
                      formatMoney(event.amountPaise, true)
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    {event.note ?? <Muted>—</Muted>}
                  </TableCell>
                  <TableCell>
                    <Muted>{formatDateTime(event.occurredAt)}</Muted>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Section>
  );
}

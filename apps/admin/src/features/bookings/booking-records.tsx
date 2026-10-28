import type { AdminAuditEntry, AdminBookingDetail } from '@clickco/contracts';
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
import { formatCode, formatDateTime } from '../../shared/format';
import { alertTone } from '../../shared/tones';
import { Empty, Section } from './section';

const MAX_CHANGE_CHARS = 160;

/** A compact one-line view of an audit before/after value. */
function compact(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_CHANGE_CHARS ? `${text.slice(0, MAX_CHANGE_CHARS)}…` : text;
}

/** The booking's alerts and its read-only audit trail (ADR-0025 D4). */
export function BookingRecords({
  booking,
  audit,
}: {
  readonly booking: AdminBookingDetail;
  readonly audit: ReadonlyArray<AdminAuditEntry> | undefined;
}) {
  return (
    <div className="grid gap-4">
      <Section title="Alerts and reviews">
        {booking.alerts.length === 0 ? (
          <Empty>No alerts for this booking.</Empty>
        ) : (
          <ul className="grid gap-3">
            {booking.alerts.map((alert) => (
              <li key={alert.eventId} className="grid gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={alertTone(alert.type)}>{formatCode(alert.type)}</Badge>
                  {alert.reason ? (
                    <Badge variant="outline">{formatCode(alert.reason)}</Badge>
                  ) : null}
                  <Muted>{formatDateTime(alert.occurredAt)}</Muted>
                </div>
                <span className="text-sm">{alert.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Audit trail" description="Every staff action on this booking. Read-only.">
        {!audit || audit.length === 0 ? (
          <Empty>No staff actions recorded.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <code className="text-sm">{entry.action}</code>
                  </TableCell>
                  <TableCell>{entry.actorEmail ?? formatCode(entry.actorKind)}</TableCell>
                  <TableCell className="max-w-md whitespace-normal">
                    <code className="break-all text-muted-foreground text-sm">
                      {compact(entry.before)} → {compact(entry.after)}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Muted>{formatDateTime(entry.occurredAt)}</Muted>
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

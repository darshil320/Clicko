import type { AdminBookingDetail } from '@clickco/contracts';
import { DescriptionItem, DescriptionList } from '@clickco/ui-web';
import { DueCell, Muted } from '../../shared/cells';
import {
  formatCode,
  formatDateTime,
  formatEmergencyBand,
  formatHours,
  formatMoney,
  formatPhone,
} from '../../shared/format';
import { Section } from './section';

/** Summary, venue, client and money (ADR-0025 D5 booking page). */
export function BookingOverview({
  booking,
  now,
}: {
  readonly booking: AdminBookingDetail;
  readonly now: number;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Summary">
        <DescriptionList>
          <DescriptionItem term="Shoot">{formatDateTime(booking.scheduledStart)}</DescriptionItem>
          <DescriptionItem term="Length">{formatHours(booking.scheduledHours)}</DescriptionItem>
          <DescriptionItem term="Category">{formatCode(booking.categoryCode)}</DescriptionItem>
          <DescriptionItem term="Plan">{formatCode(booking.tier)}</DescriptionItem>
          <DescriptionItem term="City">{booking.cityName}</DescriptionItem>
          <DescriptionItem term="Emergency band">
            {formatEmergencyBand(booking.emergencyBand)}
          </DescriptionItem>
          <DescriptionItem term="Photographer">
            {booking.photographerName ?? <Muted>Not assigned</Muted>}
          </DescriptionItem>
          <DescriptionItem term="Next due">
            <DueCell at={booking.nextDueAt} now={now} />
          </DescriptionItem>
        </DescriptionList>
      </Section>
      <Section title="Money">
        <DescriptionList>
          <DescriptionItem term="Total">{formatMoney(booking.totalPaise, true)}</DescriptionItem>
          <DescriptionItem term="Paid so far">
            {formatMoney(booking.amountPaidPaise, true)}
          </DescriptionItem>
          <DescriptionItem term="Advance">
            {formatMoney(booking.advancePaise, true)}
          </DescriptionItem>
          <DescriptionItem term="Balance">
            {formatMoney(booking.balancePaise, true)}
          </DescriptionItem>
        </DescriptionList>
      </Section>
      <Section title="Venue">
        <DescriptionList>
          <DescriptionItem term="Address" className="sm:col-span-2">
            {booking.venue.address}
          </DescriptionItem>
          <DescriptionItem term="Landmark">
            {booking.venue.landmark ?? <Muted>None given</Muted>}
          </DescriptionItem>
          <DescriptionItem term="Pincode">{booking.venue.pincode}</DescriptionItem>
        </DescriptionList>
      </Section>
      <Section title="Client">
        <DescriptionList>
          <DescriptionItem term="Name">{booking.client.name}</DescriptionItem>
          <DescriptionItem term="Phone">{formatPhone(booking.client.phone)}</DescriptionItem>
        </DescriptionList>
      </Section>
    </div>
  );
}

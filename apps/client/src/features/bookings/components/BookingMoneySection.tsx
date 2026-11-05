import { Card, ErrorState, ListRow, Section } from '@clickco/ui';
import { screenState } from '@/shared/screen-state';
import { useBookingMoney } from '../hooks';
import { hasMoneyToShow, moneyRows } from '../lib/money';

const TITLE = 'Refunds & credits';

/**
 * Refunds and credits on this booking (GET /bookings/:id/money). Shows only when there is one;
 * nothing while it loads. A failed load says so (there may be money the client is waiting on);
 * offline is already said by the screen's banner.
 */
export function BookingMoneySection({ bookingId }: { bookingId: string }) {
  const money = useBookingMoney(bookingId);
  const state = screenState(money, (data) => !hasMoneyToShow(data));

  if (state.kind === 'loading' || state.kind === 'empty' || state.kind === 'offline') return null;
  if (state.kind === 'error') {
    return (
      <Section title={TITLE}>
        <ErrorState
          variant="card"
          title="Refunds and credits didn't load"
          body={state.message}
          retrying={state.retrying}
          onRetry={() => void money.refetch()}
          testID="booking-money-error"
        />
      </Section>
    );
  }

  const rows = moneyRows(state.data);
  return (
    <Section title={TITLE} testID="booking-money">
      <Card padding="list">
        {rows.map((row, i) => (
          <ListRow
            key={row.key}
            title={row.title}
            subtitle={row.detail}
            value={row.amount}
            valueTone={row.state === 'settled' ? 'secondary' : 'primary'}
            divider={i < rows.length - 1}
          />
        ))}
      </Card>
    </Section>
  );
}

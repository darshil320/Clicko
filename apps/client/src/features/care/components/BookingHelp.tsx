import { GRIEVANCE_ACK_HOURS } from '@clickco/contracts';
import { Card, ListRow } from '@clickco/ui';
import LifeBuoy from 'lucide-react-native/icons/life-buoy';

/** On a booking: "Get help with this booking" opens the ticket form with it chosen. */
export function BookingHelp({ onGetHelp }: { onGetHelp: () => void }) {
  return (
    <Card padding="list">
      <ListRow
        icon={LifeBuoy}
        title="Get help with this booking"
        subtitle={`Payments, the shoot, the photos: we reply within ${GRIEVANCE_ACK_HOURS} hours.`}
        accessory="chevron"
        onPress={onGetHelp}
        testID="booking-get-help"
      />
    </Card>
  );
}

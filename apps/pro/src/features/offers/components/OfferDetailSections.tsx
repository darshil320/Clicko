import type { ProOffer } from '@clickco/contracts';
import { Card, ListRow, type LucideIcon, Section, Text, TIER_LABEL } from '@clickco/ui';
import CalendarClock from 'lucide-react-native/icons/calendar-clock';
import Camera from 'lucide-react-native/icons/camera';
import Images from 'lucide-react-native/icons/images';
import Lock from 'lucide-react-native/icons/lock';
import MapPin from 'lucide-react-native/icons/map-pin';
import MemoryStick from 'lucide-react-native/icons/memory-stick';
import Navigation from 'lucide-react-native/icons/navigation';
import Upload from 'lucide-react-native/icons/upload';
import UserRound from 'lucide-react-native/icons/user-round';
import { View } from 'react-native';
import { categoryIcon } from '@/shared/category-icons';
import { formatHours, formatShootWindow } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';
import { areaText, distanceText, offerRequirements, type RequirementKind } from '../lib/offers';
import { OfferBadges } from './OfferBadges';

/** "You earn" — only the total exists on an offer, so there is no base/travel split to show. */
export function PayoutHeader({ offer }: { offer: ProOffer }) {
  const payout = rupees(offer.payoutPaise);
  return (
    <View className="gap-3">
      <OfferBadges offer={offer} />
      <View className="gap-1" accessible accessibilityLabel={`You earn ${payout}`}>
        <Text variant="micro" tone="tertiary">
          You earn
        </Text>
        <Text variant="display" tabular>
          {payout}
        </Text>
      </View>
      <Text variant="caption" tone="secondary">
        For the {formatHours(offer.scheduledHours)} booked. Approved extensions and waiting time are
        paid on top.
      </Text>
    </View>
  );
}

export function ShootSection({ offer }: { offer: ProOffer }) {
  return (
    <Section title="Shoot">
      <Card padding="list">
        <ListRow
          icon={CalendarClock}
          title={formatShootWindow(offer.scheduledStart, offer.scheduledHours)}
          subtitle={formatHours(offer.scheduledHours)}
          divider
        />
        <ListRow icon={UserRound} title={offer.clientDisplayName} subtitle="Client" />
      </Card>
    </Section>
  );
}

function requirementIcon(kind: RequirementKind, categoryCode: string): LucideIcon {
  switch (kind) {
    case 'gear':
      return Camera;
    case 'dualCard':
      return MemoryStick;
    case 'frames':
      return Images;
    case 'category':
      return categoryIcon(categoryCode);
    case 'upload':
      return Upload;
  }
}

/** Doc 01 screen 12's requirements: what the client bought, so what to bring and deliver. */
export function RequirementsSection({ offer }: { offer: ProOffer }) {
  const requirements = offerRequirements(offer, TIER_LABEL[offer.tier]);
  return (
    <Section title="Requirements">
      <Card padding="list">
        {requirements.map((requirement, i) => (
          <ListRow
            key={requirement.kind}
            icon={requirementIcon(requirement.kind, offer.categoryCode)}
            title={requirement.title}
            subtitle={requirement.detail}
            divider={i < requirements.length - 1}
          />
        ))}
      </Card>
    </Section>
  );
}

/** The area only: the exact address is revealed after acceptance (ADR-0012). */
export function VenueSection({ offer }: { offer: ProOffer }) {
  return (
    <Section title="Venue">
      <Card padding="list">
        <ListRow
          icon={MapPin}
          title={areaText(offer.area)}
          subtitle={`Pincode ${offer.area.pincode}`}
          divider
        />
        <ListRow icon={Navigation} title={distanceText(offer.distanceKm)} divider />
        <ListRow icon={Lock} iconTone="tertiary" title="Exact address shown after you accept" />
      </Card>
    </Section>
  );
}

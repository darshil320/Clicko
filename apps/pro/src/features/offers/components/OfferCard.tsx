import type { ProOffer } from '@clickco/contracts';
import { Card, Icon, Text, TIER_LABEL, TierBadge } from '@clickco/ui';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import MapPin from 'lucide-react-native/icons/map-pin';
import Timer from 'lucide-react-native/icons/timer';
import { View } from 'react-native';
import { categoryLabel, emergencyLabel, isEmergency } from '@/shared/catalogue';
import { categoryIcon } from '@/shared/category-icons';
import { formatShootWindow } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';
import { formatCountdown, isUrgent, spokenCountdown } from '../lib/countdown';
import { areaText, distanceText } from '../lib/offers';
import { OfferBadges } from './OfferBadges';

export interface OfferCardProps {
  readonly offer: ProOffer;
  /** Seconds left to accept (from the feed's one clock). */
  readonly seconds: number;
  readonly onPress: () => void;
}

/** One sentence for screen readers: the card is a single button. */
function spokenOffer(offer: ProOffer, seconds: number): string {
  return [
    rupees(offer.payoutPaise),
    emergencyLabel(offer.emergencyBand),
    `${categoryLabel(offer.categoryCode)} shoot, ${TIER_LABEL[offer.tier]} tier`,
    formatShootWindow(offer.scheduledStart, offer.scheduledHours),
    areaText(offer.area),
    distanceText(offer.distanceKm),
    offer.isBroadcast ? 'Open to all nearby' : null,
    `Client ${offer.clientDisplayName}`,
    `Accept within ${spokenCountdown(seconds)}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

/** Doc 01 screen 11: payout first and big, then what, when, where, and the live countdown. */
export function OfferCard({ offer, seconds, onPress }: OfferCardProps) {
  const urgent = isUrgent(seconds);
  return (
    <Card
      onPress={onPress}
      edge={isEmergency(offer.emergencyBand) ? 'emergency' : undefined}
      accessibilityLabel={spokenOffer(offer, seconds)}
      accessibilityHint="Opens the job details"
      className="gap-3"
      testID={`offer-${offer.bookingReference}`}
    >
      <OfferBadges offer={offer} />
      <View className="flex-row items-start justify-between gap-3">
        <Text variant="h1" tabular>
          {rupees(offer.payoutPaise)}
        </Text>
        <View className="flex-row items-center gap-1 pt-1">
          <Icon icon={MapPin} size="small" />
          <Text variant="caption" tone="secondary">
            {distanceText(offer.distanceKm)}
          </Text>
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-3">
        <View className="flex-row items-center gap-2">
          <Icon icon={categoryIcon(offer.categoryCode)} size="small" tone="primary" />
          <Text variant="bodyStrong">{categoryLabel(offer.categoryCode)}</Text>
        </View>
        <TierBadge tier={offer.tier} />
      </View>
      <View className="gap-1">
        <Text tabular>{formatShootWindow(offer.scheduledStart, offer.scheduledHours)}</Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {areaText(offer.area)} · {offer.clientDisplayName}
        </Text>
      </View>
      <View className="flex-row items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <View className="flex-row items-center gap-2">
          <Icon icon={Timer} size="small" tone={urgent ? 'warning' : 'primary'} />
          <Text variant="bodyStrong" tone={urgent ? 'warning' : 'primary'} tabular>
            Accept in {formatCountdown(seconds)}
          </Text>
        </View>
        <Icon icon={ChevronRight} tone="tertiary" />
      </View>
    </Card>
  );
}

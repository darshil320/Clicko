import type { ProOffer } from '@clickco/contracts';
import { StatusBadge } from '@clickco/ui';
import Radio from 'lucide-react-native/icons/radio';
import Zap from 'lucide-react-native/icons/zap';
import { View } from 'react-native';
import { emergencyLabel, isEmergency } from '@/shared/catalogue';

/** The lead-time band (red only for the Emergency tier) and "Open to all nearby" for broadcasts. */
export function OfferBadges({ offer }: { offer: Pick<ProOffer, 'emergencyBand' | 'isBroadcast'> }) {
  const band = emergencyLabel(offer.emergencyBand);
  if (!band && !offer.isBroadcast) return null;
  const emergency = isEmergency(offer.emergencyBand);
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {band ? (
        <StatusBadge
          label={band}
          tone={emergency ? 'emergency' : 'neutral'}
          icon={emergency ? Zap : undefined}
        />
      ) : null}
      {offer.isBroadcast ? <StatusBadge label="Open to all nearby" icon={Radio} /> : null}
    </View>
  );
}

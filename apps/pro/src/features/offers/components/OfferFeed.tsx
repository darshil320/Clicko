import type { ProOffer } from '@clickco/contracts';
import { Reveal, Section, Skeleton, StateView, Text } from '@clickco/ui';
import { useRouter } from 'expo-router';
import Inbox from 'lucide-react-native/icons/inbox';
import { View } from 'react-native';
import { screenState } from '@/shared/screen-state';
import { useExpiryClock } from '../clock';
import { OFFER_POLL_MS, useOffers } from '../hooks';
import { liveOffers } from '../lib/offers';
import { OfferCard } from './OfferCard';

const POLL_SECONDS = OFFER_POLL_MS / 1000;

function OfferList({
  offers,
  onOpen,
}: {
  offers: readonly ProOffer[];
  onOpen: (attemptId: string) => void;
}) {
  return (
    <View className="gap-4">
      {offers.map((offer, i) => (
        <Reveal key={offer.attemptId} index={i}>
          <OfferCard offer={offer} onPress={() => onOpen(offer.attemptId)} />
        </Reveal>
      ))}
    </View>
  );
}

const NO_OFFERS: readonly ProOffer[] = [];

/**
 * Doc 01 screen 11, rendered inside the Jobs tab: live offers with their countdowns, emergency
 * first. An expired offer drops out the moment it closes (useExpiryClock); only each card's
 * countdown text ticks every second. The list itself polls every 10 s.
 */
export function OfferFeed() {
  const offers = useOffers();
  const now = useExpiryClock((offers.data ?? NO_OFFERS).map((offer) => offer.expiresAt));
  const router = useRouter();
  const retry = () => void offers.refetch();
  const open = (attemptId: string) =>
    router.push({ pathname: '/offers/[attemptId]', params: { attemptId } });
  const live = liveOffers(offers.data ?? NO_OFFERS, now);

  return (
    <Section
      title="New offers"
      action={
        live.length > 0 ? (
          <Text variant="caption" tone="secondary" tabular>
            {live.length} open
          </Text>
        ) : undefined
      }
      testID="offer-feed"
    >
      <StateView
        variant="card"
        state={screenState(offers, () => live.length === 0)}
        loading={
          <View className="gap-4">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </View>
        }
        errorTitle="We couldn't load offers"
        onRetry={retry}
        empty={{
          icon: Inbox,
          title: 'No offers right now',
          body: `New jobs near you show up here. Keep the app open: this list refreshes every ${POLL_SECONDS} seconds.`,
          action: { label: 'Check again', onPress: retry },
          testID: 'offers-empty',
        }}
      >
        {() => <OfferList offers={live} onOpen={open} />}
      </StateView>
    </Section>
  );
}

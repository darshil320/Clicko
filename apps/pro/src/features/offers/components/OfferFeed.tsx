import type { ProOffer } from '@clickco/contracts';
import {
  Button,
  Card,
  IconTile,
  type LucideIcon,
  Reveal,
  Section,
  Skeleton,
  Text,
} from '@clickco/ui';
import { useRouter } from 'expo-router';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import Inbox from 'lucide-react-native/icons/inbox';
import { View } from 'react-native';
import { userMessage } from '@/shared/errors';
import { useNow } from '@/shared/hooks/useNow';
import { OFFER_POLL_MS, useOffers } from '../hooks';
import { secondsLeft } from '../lib/countdown';
import { liveOffers } from '../lib/offers';
import { OfferCard } from './OfferCard';

const TICK_MS = 1000;
const POLL_SECONDS = OFFER_POLL_MS / 1000;

interface FeedNoticeProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
}

/** A compact notice (icon tile + one action): the feed shares the Jobs tab with other sections. */
function FeedNotice({ icon, title, body, actionLabel, onAction }: FeedNoticeProps) {
  return (
    <Card className="gap-4">
      <View className="flex-row items-center gap-4">
        <IconTile icon={icon} size="md" shape="circle" />
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="caption" tone="secondary">
            {body}
          </Text>
        </View>
      </View>
      <Button label={actionLabel} variant="secondary" size="compact" onPress={onAction} />
    </Card>
  );
}

function OfferList({
  offers,
  now,
  onOpen,
}: {
  offers: readonly ProOffer[];
  now: Date;
  onOpen: (attemptId: string) => void;
}) {
  return (
    <View className="gap-4">
      {offers.map((offer, i) => (
        <Reveal key={offer.attemptId} index={i}>
          <OfferCard
            offer={offer}
            seconds={secondsLeft(offer.expiresAt, now)}
            onPress={() => onOpen(offer.attemptId)}
          />
        </Reveal>
      ))}
    </View>
  );
}

/**
 * Doc 01 screen 11, rendered inside the Jobs tab: live offers with their countdowns, emergency
 * first. An expired offer drops out on the next tick; the list itself polls every 10 s.
 */
export function OfferFeed() {
  const offers = useOffers();
  const now = useNow(TICK_MS);
  const router = useRouter();
  const retry = () => void offers.refetch();
  const open = (attemptId: string) =>
    router.push({ pathname: '/offers/[attemptId]', params: { attemptId } });

  if (offers.data === undefined) {
    return (
      <Section title="New offers" testID="offer-feed">
        {offers.isError ? (
          <FeedNotice
            icon={CircleAlert}
            title="We couldn't load offers"
            body={userMessage(offers.error)}
            actionLabel="Try again"
            onAction={retry}
          />
        ) : (
          <View className="gap-4">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </View>
        )}
      </Section>
    );
  }

  const live = liveOffers(offers.data, now);
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
      {offers.isError ? (
        <Text variant="caption" tone="warning" accessibilityLiveRegion="polite">
          Couldn't refresh offers. {userMessage(offers.error)}
        </Text>
      ) : null}
      {live.length === 0 ? (
        <FeedNotice
          icon={Inbox}
          title="No offers right now"
          body={`New jobs near you appear here. Keep the app open: this list refreshes every ${POLL_SECONDS} seconds.`}
          actionLabel="Check again"
          onAction={retry}
        />
      ) : (
        <OfferList offers={live} now={now} onOpen={open} />
      )}
    </Section>
  );
}

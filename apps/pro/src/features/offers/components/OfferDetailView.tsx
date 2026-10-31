import type { ProOffer } from '@clickco/contracts';
import { Button, EmptyState, Screen, Skeleton, Text } from '@clickco/ui';
import { useRouter } from 'expo-router';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import TimerOff from 'lucide-react-native/icons/timer-off';
import { useState } from 'react';
import { View } from 'react-native';
import { userMessage } from '@/shared/errors';
import { useExpiryClock } from '../clock';
import { useAcceptOffer, useDeclineOffer, useOffer } from '../hooks';
import { secondsLeft } from '../lib/countdown';
import { DeclineSheet } from './DeclineSheet';
import { AcceptButton } from './OfferCountdown';
import {
  PayoutHeader,
  RequirementsSection,
  ShootSection,
  VenueSection,
} from './OfferDetailSections';

export interface OfferDetailViewProps {
  readonly attemptId: string;
}

function LoadingBody() {
  return (
    <View className="gap-4">
      <Skeleton className="h-6 w-24 rounded-full" />
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </View>
  );
}

/** Doc 01 screen 12. Keyed by attemptId, so each offer gets its own accept Idempotency-Key. */
export function OfferDetailView({ attemptId }: OfferDetailViewProps) {
  return <OfferDetail key={attemptId} attemptId={attemptId} />;
}

function OfferDetail({ attemptId }: OfferDetailViewProps) {
  const router = useRouter();
  const offer = useOffer(attemptId);
  // Moves only when the offer closes; the button's countdown ticks on its own (AcceptButton).
  const now = useExpiryClock(offer.data ? [offer.data.expiresAt] : []);
  const [declining, setDeclining] = useState(false);
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const accept = useAcceptOffer((assignmentId) =>
    router.replace({ pathname: '/jobs/[assignmentId]', params: { assignmentId } }),
  );
  const decline = useDeclineOffer(() => {
    setDeclining(false);
    leave();
  });

  // While an answer is in flight (or has just landed), keep showing the offer that was answered:
  // neither the 10 s poll nor the countdown may swap the screen out from under the action.
  const answering =
    accept.isPending || accept.isSuccess
      ? accept.variables
      : decline.isPending || decline.isSuccess
        ? decline.variables?.offer
        : undefined;
  const cached = offer.data ?? undefined;
  const live = cached && secondsLeft(cached.expiresAt, now) > 0 ? cached : undefined;
  const shown: ProOffer | undefined = answering ?? live;

  if (!shown) {
    return (
      <Screen topInset={false}>
        {offer.isPending ? (
          <LoadingBody />
        ) : offer.isError && offer.data === undefined ? (
          <EmptyState
            icon={CircleAlert}
            title="We couldn't load this offer"
            body={userMessage(offer.error)}
            action={{ label: 'Try again', onPress: () => void offer.refetch() }}
          />
        ) : (
          <EmptyState
            icon={TimerOff}
            title="This offer is no longer available"
            body={
              accept.isError
                ? userMessage(accept.error)
                : 'It has expired or gone to another photographer. New offers appear on the Jobs tab.'
            }
            action={{ label: 'Back to jobs', onPress: leave }}
            testID="offer-unavailable"
          />
        )}
      </Screen>
    );
  }

  const accepting = accept.isPending || accept.isSuccess;

  return (
    <Screen
      topInset={false}
      footer={
        <>
          {accept.isError ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {userMessage(accept.error)}
            </Text>
          ) : null}
          <AcceptButton
            expiresAt={shown.expiresAt}
            loading={accepting}
            disabled={decline.isPending}
            onPress={() => accept.mutate(shown)}
          />
          <Button
            label="Decline"
            variant="ghost"
            disabled={accepting || decline.isPending}
            onPress={() => setDeclining(true)}
            testID="decline-offer"
          />
        </>
      }
    >
      <PayoutHeader offer={shown} />
      <ShootSection offer={shown} />
      <RequirementsSection offer={shown} />
      <VenueSection offer={shown} />
      <Text variant="caption" tone="tertiary" tabular>
        Booking {shown.bookingReference}
      </Text>
      <DeclineSheet
        visible={declining}
        pending={decline.isPending}
        error={decline.isError ? userMessage(decline.error) : null}
        onClose={() => {
          setDeclining(false);
          if (decline.isError) decline.reset();
        }}
        onConfirm={(reason) => decline.mutate({ offer: shown, reason })}
      />
    </Screen>
  );
}

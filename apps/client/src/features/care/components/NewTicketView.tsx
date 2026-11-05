import { CLIENT_TICKET_MESSAGE_MAX, type ClientTicket } from '@clickco/contracts';
import { Button, Chip, IconTile, Input, Screen, Section, Skeleton, Text } from '@clickco/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import Check from 'lucide-react-native/icons/check';
import { useMemo } from 'react';
import { type Control, Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { screenState } from '@/shared/screen-state';
import { useBookingsForTicket, useRaiseTicket } from '../hooks';
import {
  bookingChoices,
  CATEGORY_CHOICES,
  RESPONSE_PROMISE,
  replyByLine,
  TicketForm,
  ticketErrorMessage,
  toTicketBody,
} from '../lib/tickets';

/** Lines the message box shows before it scrolls. */
const MESSAGE_LINES = 5;

/** "Which booking?" — none, or one of the recent shoots. Optional, so a failed list never blocks. */
function BookingPicker({
  control,
  preselectedId,
}: {
  control: Control<TicketForm>;
  preselectedId: string | null;
}) {
  const bookings = useBookingsForTicket();
  const state = screenState(bookings);
  const choices = useMemo(
    () => bookingChoices(bookings.data ?? [], preselectedId),
    [bookings.data, preselectedId],
  );

  return (
    <Controller
      control={control}
      name="bookingId"
      render={({ field }) => (
        <View className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            <Chip
              label="Not about a booking"
              selected={field.value === null}
              onPress={() => field.onChange(null)}
              testID="ticket-booking-none"
            />
            {choices.map((choice) => (
              <Chip
                key={choice.id}
                label={choice.label}
                selected={field.value === choice.id}
                onPress={() => field.onChange(choice.id)}
                testID={`ticket-booking-${choice.id}`}
              />
            ))}
          </View>
          {state.kind === 'loading' ? <Skeleton className="h-10 w-48 rounded-full" /> : null}
          {state.kind === 'offline' || state.kind === 'error' ? (
            <Text variant="caption" tone="tertiary">
              Your bookings didn't load. You can still send this, and mention the booking ID.
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

function Sent({ ticket, onSeeTickets }: { ticket: ClientTicket; onSeeTickets: () => void }) {
  return (
    <Screen
      topInset={false}
      footer={<Button label="See my tickets" onPress={onSeeTickets} testID="ticket-done" />}
    >
      <View
        className="items-center gap-4 pt-12"
        accessibilityLiveRegion="polite"
        testID="ticket-sent"
      >
        <IconTile icon={Check} tone="success" size="lg" shape="circle" />
        <View className="items-center gap-2">
          <Text variant="h1" align="center">
            We've got it
          </Text>
          <Text tone="secondary" align="center" tabular>
            {replyByLine(ticket)}
          </Text>
          <Text variant="caption" tone="tertiary" align="center" tabular>
            Ticket number {ticket.reference}
          </Text>
        </View>
      </View>
    </Screen>
  );
}

export interface NewTicketViewProps {
  /** From a booking's "Get help": that booking is chosen to begin with. */
  readonly bookingId?: string | undefined;
  /** After sending: back to the Help tab, where the ticket now shows. */
  readonly onSeeTickets: () => void;
}

/** "Get help" (SA-02): what it is about, which booking (optional), and what happened. */
export function NewTicketView({ bookingId, onSeeTickets }: NewTicketViewProps) {
  const raise = useRaiseTicket();
  const preselectedId = bookingId ?? null;
  const form = useForm<TicketForm>({
    resolver: zodResolver(TicketForm),
    defaultValues: { bookingId: preselectedId, message: '' },
  });
  const send = form.handleSubmit((values) => raise.mutate(toTicketBody(values)));

  if (raise.data) return <Sent ticket={raise.data} onSeeTickets={onSeeTickets} />;

  return (
    <Screen
      topInset={false}
      title="How can we help?"
      titleVariant="h1"
      subtitle={RESPONSE_PROMISE}
      footer={
        <>
          {raise.isError ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {ticketErrorMessage(raise.error)}
            </Text>
          ) : null}
          <Button
            label="Send"
            onPress={() => void send()}
            loading={raise.isPending}
            testID="ticket-send"
          />
        </>
      }
    >
      <Section title="What's it about?">
        <Controller
          control={form.control}
          name="category"
          render={({ field, fieldState }) => (
            <View className="gap-2">
              <View className="flex-row flex-wrap gap-2">
                {CATEGORY_CHOICES.map((choice) => (
                  <Chip
                    key={choice.value}
                    label={choice.label}
                    selected={field.value === choice.value}
                    onPress={() => field.onChange(choice.value)}
                    testID={`ticket-category-${choice.value}`}
                  />
                ))}
              </View>
              {fieldState.error ? (
                <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                  {fieldState.error.message}
                </Text>
              ) : null}
            </View>
          )}
        />
      </Section>

      <Section title="Which booking?" subtitle="Optional">
        <BookingPicker control={form.control} preselectedId={preselectedId} />
      </Section>

      <Controller
        control={form.control}
        name="message"
        render={({ field, fieldState }) => (
          <Input
            label="Tell us what happened"
            placeholder="I paid the balance on Monday but my photos are still locked"
            multiline
            numberOfLines={MESSAGE_LINES}
            maxLength={CLIENT_TICKET_MESSAGE_MAX}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            testID="ticket-message"
          />
        )}
      />
    </Screen>
  );
}

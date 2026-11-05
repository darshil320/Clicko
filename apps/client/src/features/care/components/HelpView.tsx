import type { ClientTicket } from '@clickco/contracts';
import {
  Button,
  Card,
  IconTile,
  palette,
  Reveal,
  Screen,
  Section,
  Skeleton,
  StateView,
  StatusBadge,
  Text,
} from '@clickco/ui';
import LifeBuoy from 'lucide-react-native/icons/life-buoy';
import Ticket from 'lucide-react-native/icons/ticket';
import { RefreshControl, View } from 'react-native';
import { useNow } from '@/shared/hooks/useNow';
import { screenState } from '@/shared/screen-state';
import { useTickets } from '../hooks';
import { deadlineLine, RESPONSE_PROMISE, sentAtLine, ticketStatus } from '../lib/tickets';

const CLOCK_TICK_MS = 60_000;

function TicketCard({ ticket, now }: { ticket: ClientTicket; now: Date }) {
  const status = ticketStatus(ticket.status);
  const deadline = deadlineLine(ticket, now);
  return (
    <Card className="gap-3" testID={`ticket-${ticket.reference}`}>
      <View className="flex-row items-center justify-between gap-3">
        <StatusBadge label={status.label} tone={status.tone} />
        <Text variant="caption" tone="tertiary" tabular>
          {ticket.reference}
        </Text>
      </View>
      <View className="gap-1">
        <Text variant="bodyStrong" numberOfLines={2}>
          {ticket.subject}
        </Text>
        <Text variant="caption" tone="secondary" tabular>
          {sentAtLine(ticket)}
        </Text>
      </View>
      <Text
        variant="caption"
        tone="secondary"
        tabular
        className="border-t border-border-subtle pt-3"
      >
        {deadline}
      </Text>
      {ticket.resolutionSummary ? (
        <Text variant="caption" tone="secondary">
          What we did: {ticket.resolutionSummary}
        </Text>
      ) : null}
    </Card>
  );
}

export interface HelpViewProps {
  /** Opens the "Get help" ticket form. */
  readonly onGetHelp: () => void;
}

/** The Help tab (SA-02): ask for help, and follow every ticket with its next deadline. */
export function HelpView({ onGetHelp }: HelpViewProps) {
  const tickets = useTickets();
  const now = useNow(CLOCK_TICK_MS);

  return (
    <Screen
      title="Help"
      refreshControl={
        <RefreshControl
          refreshing={tickets.isRefetching}
          onRefresh={() => void tickets.refetch()}
          tintColor={palette.text.secondary}
          colors={[palette.text.primary]}
        />
      }
    >
      <Card className="gap-4">
        <View className="flex-row items-center gap-4">
          <IconTile icon={LifeBuoy} tone="accentSubtle" size="md" shape="circle" />
          <View className="flex-1 gap-1">
            <Text variant="bodyStrong">Need a hand?</Text>
            <Text variant="caption" tone="secondary">
              {RESPONSE_PROMISE}
            </Text>
          </View>
        </View>
        <Button label="Get help" onPress={onGetHelp} testID="get-help" />
      </Card>

      <Section title="My tickets">
        <StateView
          variant="card"
          state={screenState(tickets)}
          loading={
            <View className="gap-4">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </View>
          }
          errorTitle="We couldn't load your tickets"
          onRetry={() => void tickets.refetch()}
          empty={{
            icon: Ticket,
            title: 'No tickets yet',
            body: 'When you ask for help, you can follow it here.',
            testID: 'tickets-empty',
          }}
        >
          {(list) => (
            <View className="gap-4">
              {list.map((ticket, i) => (
                <Reveal key={ticket.id} index={i}>
                  <TicketCard ticket={ticket} now={now} />
                </Reveal>
              ))}
            </View>
          )}
        </StateView>
      </Section>
    </Screen>
  );
}

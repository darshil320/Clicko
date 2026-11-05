import {
  type BookingDetail,
  CLIENT_QUALITY_COMPLAINT_MAX,
  ClientQualityIssueBody,
} from '@clickco/contracts';
import { BottomSheet, Button, Card, IconTile, Input, Text } from '@clickco/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import Check from 'lucide-react-native/icons/check';
import ImageOff from 'lucide-react-native/icons/image-off';
import SearchCheck from 'lucide-react-native/icons/search-check';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { useNow } from '@/shared/hooks/useNow';
import { useReportQualityIssue } from '../hooks';
import {
  isAlreadyReported,
  isFinalRefusal,
  qualityErrorMessage,
  reportWindow,
  windowLine,
} from '../lib/quality';

const CLOCK_TICK_MS = 60_000;
/** Lines the complaint box shows before it scrolls. */
const COMPLAINT_LINES = 4;

function UnderReview() {
  return (
    <Card className="flex-row gap-4" testID="quality-under-review">
      <IconTile icon={SearchCheck} tone="warning" size="sm" shape="circle" />
      <View className="flex-1 gap-1">
        <Text variant="bodyStrong">We're looking into your photos</Text>
        <Text variant="caption" tone="secondary">
          Our quality team has your report and will update you on this booking.
        </Text>
      </View>
    </Card>
  );
}

/** One tap gets this: the report is in, nothing else to do. */
function Sent({ onDone }: { onDone: () => void }) {
  return (
    <View className="items-center gap-4" accessibilityLiveRegion="polite" testID="quality-sent">
      <IconTile icon={Check} tone="success" size="lg" shape="circle" />
      <View className="items-center gap-2">
        <Text variant="h2" align="center">
          Thanks, we've got it
        </Text>
        <Text tone="secondary" align="center">
          Our quality team will review your photos and update you on this booking.
        </Text>
      </View>
      <Button label="Done" variant="secondary" onPress={onDone} />
    </View>
  );
}

function ReportForm({ bookingId, onSent }: { bookingId: string; onSent: () => void }) {
  const report = useReportQualityIssue(bookingId);
  const form = useForm<ClientQualityIssueBody>({
    resolver: zodResolver(ClientQualityIssueBody),
    defaultValues: { complaint: '' },
  });
  // Already reported (another device, or a lost answer): that is a success for the client.
  const send = form.handleSubmit((body) =>
    report.mutate(body, {
      onSuccess: onSent,
      onError: (error) => {
        if (isAlreadyReported(error)) onSent();
      },
    }),
  );
  const failure = report.isError && !isAlreadyReported(report.error) ? report.error : null;

  return (
    <View className="gap-4">
      <Text tone="secondary">
        What's wrong with them? Blurry shots, missing moments, the wrong files — tell us in your own
        words.
      </Text>
      <Controller
        control={form.control}
        name="complaint"
        render={({ field, fieldState }) => (
          <Input
            label="Describe the problem"
            placeholder="Most of the cake shots are out of focus"
            multiline
            numberOfLines={COMPLAINT_LINES}
            maxLength={CLIENT_QUALITY_COMPLAINT_MAX}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            testID="quality-complaint"
          />
        )}
      />
      {failure ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {qualityErrorMessage(failure)}
        </Text>
      ) : null}
      <Button
        label="Send report"
        onPress={() => void send()}
        loading={report.isPending}
        disabled={failure !== null && isFinalRefusal(failure)}
        testID="quality-send"
      />
    </View>
  );
}

/**
 * "Report a problem with my photos" on a booking (ADR-0027 D5): offered on a DELIVERED booking
 * within 30 days of delivery; once reported, the booking says it is under review.
 */
export function ReportProblem({ detail }: { detail: BookingDetail }) {
  const now = useNow(CLOCK_TICK_MS);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const offer = reportWindow(detail.booking.status, detail.timeline, now);
  const close = () => {
    setOpen(false);
    setSent(false);
  };

  if (offer.kind === 'reported' && !open) return <UnderReview />;
  if (offer.kind === 'hidden' && !open) return null;

  return (
    <>
      {offer.kind === 'open' ? (
        <Card className="gap-4" testID="quality-report">
          <View className="flex-row gap-4">
            <IconTile icon={ImageOff} size="sm" shape="circle" />
            <View className="flex-1 gap-1">
              <Text variant="bodyStrong">Something off with your photos?</Text>
              <Text variant="caption" tone="secondary">
                {windowLine(offer.closesAt)}
              </Text>
            </View>
          </View>
          <Button
            label="Report a problem"
            variant="secondary"
            size="compact"
            onPress={() => setOpen(true)}
            testID="quality-open"
          />
        </Card>
      ) : (
        <UnderReview />
      )}
      <BottomSheet
        visible={open}
        onClose={close}
        title={sent ? undefined : 'Report a problem with your photos'}
        testID="quality-sheet"
      >
        {sent ? (
          <Sent onDone={close} />
        ) : (
          <ReportForm bookingId={detail.booking.id} onSent={() => setSent(true)} />
        )}
      </BottomSheet>
    </>
  );
}

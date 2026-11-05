import { Button, IconTile, Input, Screen, Text } from '@clickco/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import MessageSquareText from 'lucide-react-native/icons/message-square-text';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { formatPhone } from '@/shared/format/phone';
import { useNow } from '@/shared/hooks/useNow';
import { formatCountdown, OtpForm, secondsUntil } from '@/shared/otp';
import { useConfirmDeletion, useRequestDeletion } from '../hooks';
import { deletionFailure } from '../lib/deletion';
import type { SentCode } from '../store';

const TICK_MS = 1000;

export interface CodeStepProps {
  readonly sent: SentCode;
  readonly phone: string;
  readonly onKeep: () => void;
}

/**
 * Step two, the irreversible one: the code from the SMS (the sign-in code field and resend
 * countdown), then "Delete my account". "Keep my account" sits right under it, as plain as the
 * delete: no dark patterns.
 */
export function CodeStep({ sent, phone, onKeep }: CodeStepProps) {
  const confirm = useConfirmDeletion();
  const resend = useRequestDeletion();
  const now = useNow(TICK_MS).getTime();
  const waitSeconds = secondsUntil(sent.resendAt, now);
  const expired = now >= sent.expiresAt;
  const form = useForm<OtpForm>({ resolver: zodResolver(OtpForm), defaultValues: { code: '' } });

  const submit = form.handleSubmit(({ code }) =>
    confirm.mutate({ challengeId: sent.challengeId, code: code.trim() }),
  );
  const sendAgain = () =>
    resend.mutate(undefined, {
      onSuccess: () => {
        confirm.reset();
        form.reset({ code: '' });
      },
    });
  const error = confirm.error ?? resend.error;
  const failure = error ? deletionFailure(error) : null;

  return (
    <Screen
      topInset={false}
      footer={
        <>
          <Button
            label="Delete my account"
            variant="danger"
            loading={confirm.isPending}
            onPress={submit}
            accessibilityHint="Deletes your account now. This can't be undone."
            testID="deletion-confirm"
          />
          <Button
            label="Keep my account"
            variant="ghost"
            onPress={onKeep}
            disabled={confirm.isPending}
            testID="deletion-keep"
          />
        </>
      }
    >
      <View className="gap-3 pt-4">
        <View className="pb-2">
          <IconTile icon={MessageSquareText} tone="accentSubtle" size="md" shape="circle" />
        </View>
        <Text variant="h1" accessibilityRole="header">
          Enter the code to delete your account
        </Text>
        <Text tone="secondary" tabular>
          Sent to {formatPhone(phone)}. Once you confirm, your account is deleted straight away.
          This can't be undone.
        </Text>
      </View>
      <Controller
        control={form.control}
        name="code"
        render={({ field, fieldState }) => (
          <Input
            label="6-digit code"
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            testID="deletion-otp-input"
          />
        )}
      />
      {failure ? (
        <Text tone="danger" accessibilityLiveRegion="polite" testID="deletion-error">
          {failure.message}
        </Text>
      ) : expired ? (
        <Text tone="secondary" accessibilityLiveRegion="polite">
          This code has expired. Send a new one.
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          label={waitSeconds > 0 ? `Resend code in ${formatCountdown(waitSeconds)}` : 'Resend code'}
          variant="secondary"
          size="compact"
          disabled={waitSeconds > 0}
          loading={resend.isPending}
          onPress={sendAgain}
          testID="deletion-resend"
        />
      </View>
    </Screen>
  );
}

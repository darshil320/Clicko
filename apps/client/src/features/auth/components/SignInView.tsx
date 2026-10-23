import { Button, Input, Screen, Text } from '@clickco/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { IS_DEV } from '@/shared/config';
import { userMessage } from '@/shared/errors';
import { formatPhone } from '@/shared/format/phone';
import { useNow } from '@/shared/hooks/useNow';
import { useDevOtp, useRequestOtp, useVerifyOtp } from '../hooks';
import { formatCountdown, OtpForm, PhoneForm, secondsUntil, toE164 } from '../lib/phone';
import { useSignInFlow } from '../store';

function PhoneStep() {
  const requestOtp = useRequestOtp();
  const form = useForm<PhoneForm>({
    resolver: zodResolver(PhoneForm),
    defaultValues: { phone: '' },
  });

  const submit = form.handleSubmit(({ phone }) => {
    const e164 = toE164(phone);
    if (e164) requestOtp.mutate(e164);
  });

  return (
    <Screen
      footer={
        <Button
          label="Send code"
          onPress={submit}
          loading={requestOtp.isPending}
          testID="send-code"
        />
      }
    >
      <View className="gap-2 pt-10">
        <Text variant="display">Clickco</Text>
        <Text variant="h2">Book a professional photographer</Text>
        <Text tone="secondary">
          Sign in with your mobile number. We'll send you a 6-digit code.
        </Text>
      </View>
      <Controller
        control={form.control}
        name="phone"
        render={({ field, fieldState }) => (
          <Input
            label="Mobile number"
            prefix="+91"
            placeholder="98000 00777"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            onSubmitEditing={submit}
            error={fieldState.error?.message}
            testID="phone-input"
          />
        )}
      />
      {requestOtp.isError ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {userMessage(requestOtp.error)}
        </Text>
      ) : null}
      <Text variant="caption" tone="tertiary">
        By continuing you agree to receive a one-time code by SMS.
      </Text>
    </Screen>
  );
}

function CodeStep({
  phone,
  challengeId,
  resendAt,
}: {
  phone: string;
  challengeId: string;
  resendAt: number;
}) {
  const verify = useVerifyOtp();
  const resend = useRequestOtp();
  const devOtp = useDevOtp();
  const reset = useSignInFlow((s) => s.reset);
  const now = useNow(1000);
  const waitSeconds = secondsUntil(resendAt, now.getTime());
  const form = useForm<OtpForm>({ resolver: zodResolver(OtpForm), defaultValues: { code: '' } });

  const submit = form.handleSubmit(({ code }) => verify.mutate({ challengeId, phone, code }));
  const fillDevOtp = () =>
    devOtp.mutate(phone, {
      onSuccess: ({ code }) => form.setValue('code', code, { shouldValidate: true }),
    });
  const failure = verify.error ?? resend.error ?? devOtp.error;

  return (
    <Screen
      footer={
        <>
          <Button
            label="Verify and continue"
            onPress={submit}
            loading={verify.isPending}
            testID="verify"
          />
          {IS_DEV ? (
            <Button
              label="Fill dev OTP"
              variant="ghost"
              onPress={fillDevOtp}
              loading={devOtp.isPending}
              accessibilityHint="Development only: reads the code the API printed"
              testID="fill-dev-otp"
            />
          ) : null}
        </>
      }
    >
      <View className="gap-2 pt-10">
        <Text variant="h1">Enter the code</Text>
        <Text tone="secondary">Sent to {formatPhone(phone)}</Text>
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
            onSubmitEditing={submit}
            error={fieldState.error?.message}
            testID="otp-input"
          />
        )}
      />
      {failure ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {userMessage(failure)}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={waitSeconds > 0 ? `Resend code in ${formatCountdown(waitSeconds)}` : 'Resend code'}
          variant="secondary"
          size="compact"
          disabled={waitSeconds > 0}
          loading={resend.isPending}
          onPress={() => resend.mutate(phone)}
        />
        <Button label="Change number" variant="ghost" size="compact" onPress={reset} />
      </View>
    </Screen>
  );
}

/** Phone OTP sign-in: number → code → session. */
export function SignInView() {
  const { phone, challengeId, resendAt } = useSignInFlow();
  if (phone && challengeId && resendAt !== null) {
    return <CodeStep phone={phone} challengeId={challengeId} resendAt={resendAt} />;
  }
  return <PhoneStep />;
}

import type { ServiceabilityResult } from '@clickco/contracts';
import { BottomSheet, Button, Card, IconTile, Input, Skeleton, Text } from '@clickco/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import BellRing from 'lucide-react-native/icons/bell-ring';
import MapPin from 'lucide-react-native/icons/map-pin';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { userMessage } from '@/shared/errors';
import { formatPhone } from '@/shared/format/phone';
import { useSession } from '@/shared/session/store';
import { useJoinWaitlist, useServiceability } from '../hooks';
import {
  locationLabel,
  normalisePincode,
  notServedHeadline,
  PincodeForm,
  WaitlistForm,
  waitingLine,
} from '../lib/pincode';
import { useLocation } from '../store';

type Bookable = Extract<ServiceabilityResult, { bookable: true }>;
type NotBookable = Extract<ServiceabilityResult, { bookable: false }>;

function ServedResult({ result, onUse }: { result: Bookable; onUse: () => void }) {
  const label = locationLabel(result);
  return (
    <View className="gap-4">
      <Card className="flex-row gap-4">
        <IconTile icon={MapPin} tone="success" size="sm" shape="circle" />
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong">We shoot in {label}</Text>
          <Text variant="caption" tone="secondary">
            {result.limitedAvailability || result.status === 'PILOT'
              ? 'Pilot area — photographers are limited, so book a little ahead.'
              : 'Photographers are available across this area.'}
          </Text>
        </View>
      </Card>
      <Button label={`Use ${label}`} onPress={onUse} testID="use-location" />
    </View>
  );
}

function WaitlistResult({ result }: { result: NotBookable }) {
  const user = useSession((s) => s.user);
  const join = useJoinWaitlist();
  const form = useForm<WaitlistForm>({
    resolver: zodResolver(WaitlistForm),
    defaultValues: { fullName: user?.fullName ?? '' },
  });
  const waiting = waitingLine(join.data?.waitingCount ?? result.waitingCount);

  const submit = form.handleSubmit(({ fullName }) => {
    if (!user) return;
    join.mutate({
      phone: user.phone,
      fullName,
      pincode: result.pincode,
      ...(result.cityName ? { cityNameRaw: result.cityName } : {}),
    });
  });

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text variant="bodyStrong">{notServedHeadline(result)}</Text>
        <Text variant="caption" tone="secondary">
          Clickco is live in Surat and Mumbai, with a pilot in Vadodara.
        </Text>
        {waiting ? (
          <Text variant="caption" tone="tertiary">
            {waiting}
          </Text>
        ) : null}
      </View>
      {join.isSuccess ? (
        <Card tone="accent" className="flex-row gap-4">
          <IconTile icon={BellRing} tone="accent" size="sm" shape="circle" />
          <View className="flex-1 gap-1">
            <Text variant="bodyStrong">You're on the list</Text>
            <Text variant="caption" tone="secondary">
              {user
                ? `We'll message ${formatPhone(user.phone)} when we start shooting here.`
                : null}
            </Text>
          </View>
        </Card>
      ) : result.canJoinWaitlist && user ? (
        <>
          <Controller
            control={form.control}
            name="fullName"
            render={({ field, fieldState }) => (
              <Input
                label="Your name"
                placeholder="Priya Sharma"
                autoComplete="name"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />
          {join.isError ? <Text tone="danger">{userMessage(join.error)}</Text> : null}
          <Button
            label="Join the waitlist"
            variant="secondary"
            onPress={submit}
            loading={join.isPending}
          />
        </>
      ) : null}
    </View>
  );
}

export interface PincodeSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

/** Pincode → serviceability. Served: save it. Not served: offer the waitlist. */
export function PincodeSheet({ visible, onClose }: PincodeSheetProps) {
  const current = useLocation((s) => s.pincode);
  const setLocation = useLocation((s) => s.setLocation);
  const [checking, setChecking] = useState<string | null>(null);
  const check = useServiceability(checking);
  const form = useForm<PincodeForm>({
    resolver: zodResolver(PincodeForm),
    defaultValues: { pincode: current ?? '' },
  });

  const submit = form.handleSubmit(({ pincode }) => setChecking(normalisePincode(pincode)));
  const close = () => {
    setChecking(null);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Where is the shoot?"
      testID="pincode-sheet"
    >
      <View className="gap-4">
        <Controller
          control={form.control}
          name="pincode"
          render={({ field, fieldState }) => (
            <Input
              label="Venue pincode"
              placeholder="395007"
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="postal-code"
              value={field.value}
              onChangeText={(text) => {
                field.onChange(text);
                setChecking(null);
              }}
              onBlur={field.onBlur}
              onSubmitEditing={submit}
              error={fieldState.error?.message}
              testID="pincode-input"
            />
          )}
        />
        {checking === null ? (
          <Button
            label="Check pincode"
            variant="secondary"
            onPress={submit}
            testID="check-pincode"
          />
        ) : check.isPending ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : check.isError ? (
          <View className="gap-3">
            <Text tone="danger">{userMessage(check.error)}</Text>
            <Button label="Try again" variant="secondary" onPress={() => check.refetch()} />
          </View>
        ) : check.data?.bookable ? (
          <ServedResult
            result={check.data}
            onUse={() => {
              const result = check.data;
              if (!result?.bookable) return;
              setLocation({
                pincode: result.pincode,
                label: locationLabel(result),
                cityName: result.city.name,
              });
              close();
            }}
          />
        ) : check.data ? (
          <WaitlistResult result={check.data} />
        ) : null}
      </View>
    </BottomSheet>
  );
}

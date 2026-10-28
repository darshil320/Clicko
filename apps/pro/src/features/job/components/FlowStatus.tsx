import { Icon, Text, type Tone } from '@clickco/ui';
import LocateFixed from 'lucide-react-native/icons/locate-fixed';
import { View } from 'react-native';
import {
  type AccuracyLevel,
  accuracyLevel,
  type DeviceFix,
  formatAccuracy,
} from '@/shared/location/fix';
import type { OnsiteFlow } from '../hooks';

const LEVEL: Readonly<Record<AccuracyLevel, { readonly label: string; readonly tone: Tone }>> = {
  GOOD: { label: 'Good', tone: 'success' },
  FAIR: { label: 'Fair', tone: 'secondary' },
  POOR: { label: 'Too rough', tone: 'danger' },
};

/** "GPS ±12 m · Good" — the fix the app just took, so the photographer sees what was sent. */
export function FixLine({ fix }: { fix: DeviceFix | null }) {
  if (!fix) return null;
  const level = fix.mocked
    ? { label: 'Mock location', tone: 'danger' as const }
    : LEVEL[accuracyLevel(fix.accuracyM)];
  const text = `GPS ${formatAccuracy(fix.accuracyM)} · ${level.label}`;
  return (
    <View
      accessible
      accessibilityLabel={`GPS accuracy ${formatAccuracy(fix.accuracyM)}, ${level.label}`}
      className="flex-row items-center gap-2"
    >
      <Icon icon={LocateFixed} tone={level.tone} size="small" />
      <Text variant="caption" tone={level.tone} tabular>
        {text}
      </Text>
    </View>
  );
}

/** An error sentence, announced as it appears. */
export function ErrorText({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Text
      variant="caption"
      tone="danger"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      {message}
    </Text>
  );
}

export interface FlowStatusProps {
  readonly flow: OnsiteFlow;
  /** Calm guidance shown while there is no error. */
  readonly hint?: string;
}

/** The line above an on-site button: getting a fix → the fix's accuracy → any refusal. */
export function FlowStatus({ flow, hint }: FlowStatusProps) {
  return (
    <View className="gap-1">
      {flow.phase === 'locating' ? (
        <Text variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          Getting a GPS fix…
        </Text>
      ) : (
        <FixLine fix={flow.fix} />
      )}
      {flow.error ? (
        <ErrorText message={flow.error} />
      ) : hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

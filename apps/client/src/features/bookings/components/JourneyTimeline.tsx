import { Icon, Text, type Tone } from '@clickco/ui';
import Circle from 'lucide-react-native/icons/circle';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleDot from 'lucide-react-native/icons/circle-dot';
import { View } from 'react-native';
import type { JourneyStep, StepState } from '@/shared/booking-status';

const STEP_ICON = { done: CircleCheck, current: CircleDot, upcoming: Circle } as const;
const STEP_TONE: Readonly<Record<StepState, Tone>> = {
  done: 'primary',
  current: 'accent',
  upcoming: 'tertiary',
};
const STEP_SUFFIX: Readonly<Record<StepState, string>> = {
  done: 'done',
  current: 'in progress',
  upcoming: 'next',
};

/** Vertical four-step timeline: Booked → Photographer assigned → Shoot day → Photos. */
export function JourneyTimeline({ steps }: { steps: readonly JourneyStep[] }) {
  return (
    <View accessibilityRole="list">
      {steps.map((step, i) => (
        <View
          key={step.key}
          className="flex-row gap-3"
          accessible
          accessibilityLabel={`${step.label}, ${STEP_SUFFIX[step.state]}`}
        >
          <View className="items-center">
            <Icon icon={STEP_ICON[step.state]} tone={STEP_TONE[step.state]} />
            {i < steps.length - 1 ? <View className="h-6 w-px bg-border-strong" /> : null}
          </View>
          <Text
            variant={step.state === 'current' ? 'bodyStrong' : 'body'}
            tone={step.state === 'upcoming' ? 'tertiary' : 'primary'}
          >
            {step.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

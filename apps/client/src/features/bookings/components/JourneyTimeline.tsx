import { IconTile, type IconTileTone, type LucideIcon, Text } from '@clickco/ui';
import Check from 'lucide-react-native/icons/check';
import Circle from 'lucide-react-native/icons/circle';
import CircleDot from 'lucide-react-native/icons/circle-dot';
import { View } from 'react-native';
import type { JourneyStep, StepState } from '@/shared/booking-status';

/** Done steps are calm green checks; the live step is the amber fill; what's next stays quiet. */
const STEP_MARK: Readonly<Record<StepState, { icon: LucideIcon; tone: IconTileTone }>> = {
  done: { icon: Check, tone: 'success' },
  current: { icon: CircleDot, tone: 'accent' },
  upcoming: { icon: Circle, tone: 'neutral' },
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
          className="flex-row gap-4"
          accessible
          accessibilityLabel={`${step.label}, ${STEP_SUFFIX[step.state]}`}
        >
          <View className="items-center">
            <IconTile
              icon={STEP_MARK[step.state].icon}
              tone={STEP_MARK[step.state].tone}
              size="sm"
              shape="circle"
            />
            {i < steps.length - 1 ? (
              <View
                className={
                  step.state === 'done' ? 'h-5 w-px bg-success/40' : 'h-5 w-px bg-border-strong'
                }
              />
            ) : null}
          </View>
          <View className="h-8 flex-1 justify-center">
            <Text
              variant={step.state === 'current' ? 'bodyStrong' : 'body'}
              tone={step.state === 'upcoming' ? 'tertiary' : 'primary'}
            >
              {step.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

import type { EarningsJob } from '@clickco/contracts';
import { Card, EmptyState, ListRow, Reveal, Section, Text } from '@clickco/ui';
import Wallet from 'lucide-react-native/icons/wallet';
import { View } from 'react-native';
import { categoryIcon } from '@/shared/category-icons';
import { rupees } from '@/shared/format/money';
import { groupByDay, jobSubtitle, jobTitle } from '../lib/earnings';

export interface EarningsJobListProps {
  readonly jobs: readonly EarningsJob[];
  /** The server's clock (`asOf`) decides what "Today" is. */
  readonly asOf: Date;
  readonly onFindJobs: () => void;
}

/** Completed shoots by day of check-out, each with its expected payout (extras on a second line). */
export function EarningsJobList({ jobs, asOf, onFindJobs }: EarningsJobListProps) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={Wallet}
        title="No completed shoots yet"
        body="Your expected earnings appear here once you check out of a shoot."
        action={{ label: 'See new offers', onPress: onFindJobs }}
        testID="earnings-empty"
      />
    );
  }
  const days = groupByDay(jobs, asOf);
  return (
    <Section title="Completed shoots" subtitle="Most recent first">
      <View className="gap-5">
        {days.map((day, i) => (
          <Reveal key={day.key} index={i} className="gap-2">
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel={`${day.label}, ${rupees(day.totalPaise)}`}
              className="flex-row items-center justify-between gap-3"
            >
              <Text variant="micro" tone="tertiary">
                {day.label}
              </Text>
              <Text variant="micro" tone="secondary" tabular>
                {rupees(day.totalPaise)}
              </Text>
            </View>
            <Card padding="list">
              {day.jobs.map((job, j) => (
                <ListRow
                  key={job.assignmentId}
                  icon={categoryIcon(job.categoryCode)}
                  title={jobTitle(job)}
                  subtitle={jobSubtitle(job)}
                  value={rupees(job.totalPayoutPaise)}
                  divider={j < day.jobs.length - 1}
                  testID={`earning-${job.bookingReference}`}
                />
              ))}
            </Card>
          </Reveal>
        ))}
      </View>
    </Section>
  );
}

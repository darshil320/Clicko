import { EmptyState, palette, Screen, Skeleton } from '@clickco/ui';
import { useRouter } from 'expo-router';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import { RefreshControl, View } from 'react-native';
import { userMessage } from '@/shared/errors';
import { useEarnings } from '../hooks';
import { EarningsJobList } from './EarningsJobList';
import { EarningsSummary } from './EarningsSummary';

function LoadingBody() {
  return (
    <View className="gap-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </View>
  );
}

/**
 * Earnings tab (doc 01 screen 15, ADR-0024 D3): this month big, today / week / pending, and the
 * completed shoots. The city ranking and the 30-day chart wait for API data (ADR-0024 D3).
 */
export function EarningsView() {
  const earnings = useEarnings();
  const router = useRouter();

  return (
    <Screen
      title="Earnings"
      refreshControl={
        <RefreshControl
          refreshing={earnings.isRefetching}
          onRefresh={() => void earnings.refetch()}
          tintColor={palette.text.secondary}
          colors={[palette.text.primary]}
        />
      }
    >
      {earnings.data !== undefined ? (
        <>
          <EarningsSummary earnings={earnings.data} />
          <EarningsJobList
            jobs={earnings.data.jobs}
            asOf={new Date(earnings.data.asOf)}
            onFindJobs={() => router.navigate('/')}
          />
        </>
      ) : earnings.isError ? (
        <EmptyState
          icon={CircleAlert}
          title="We couldn't load your earnings"
          body={userMessage(earnings.error)}
          action={{ label: 'Try again', onPress: () => void earnings.refetch() }}
        />
      ) : (
        <LoadingBody />
      )}
    </Screen>
  );
}

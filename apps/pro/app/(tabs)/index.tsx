import { Screen } from '@clickco/ui';
import { TodayEarningsLine } from '@/features/earnings';
import { ActiveJobs, UploadsDue } from '@/features/job';
import { OfferFeed } from '@/features/offers';

/** Jobs tab (doc 01 screen 11): what you are booked for, new offers, and uploads that are due. */
export default function JobsRoute() {
  return (
    <Screen title="Jobs" header={<TodayEarningsLine />}>
      <ActiveJobs />
      <OfferFeed />
      <UploadsDue />
    </Screen>
  );
}

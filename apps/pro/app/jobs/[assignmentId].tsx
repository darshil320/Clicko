import { useLocalSearchParams } from 'expo-router';
import { JobView } from '@/features/job';

export default function JobRoute() {
  const { assignmentId } = useLocalSearchParams<{ assignmentId: string }>();
  return <JobView assignmentId={assignmentId} />;
}

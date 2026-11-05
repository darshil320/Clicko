import { useRouter } from 'expo-router';
import { HelpView } from '@/features/care';

/** Help (SA-02): get help, and follow your tickets. */
export default function HelpRoute() {
  const router = useRouter();
  return <HelpView onGetHelp={() => router.push('/support/new')} />;
}

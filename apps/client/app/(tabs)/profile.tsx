import { useRouter } from 'expo-router';
import { ProfileView } from '@/features/auth';

export default function ProfileRoute() {
  const router = useRouter();
  return <ProfileView onGetHelp={() => router.push('/support/new')} />;
}

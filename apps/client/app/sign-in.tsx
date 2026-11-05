import { AccountDeletedView, useAccountDeletedNotice } from '@/features/account';
import { SignInView } from '@/features/auth';

/** The signed-out start. Right after an account deletion it says so once, first. */
export default function SignInRoute() {
  const notice = useAccountDeletedNotice();
  if (notice.deleted) return <AccountDeletedView onContinue={notice.dismiss} />;
  return <SignInView />;
}

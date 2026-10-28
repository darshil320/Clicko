import { EmptyState, ShieldAlertIcon } from '@clickco/ui-web';
import { NO_ACCESS } from '../../shared/errors';

/** A desk the roles do not allow (the API would refuse it anyway). */
export function NoAccess() {
  return (
    <EmptyState
      icon={<ShieldAlertIcon />}
      title={NO_ACCESS}
      description="Ask a super admin if your work needs this desk."
    />
  );
}

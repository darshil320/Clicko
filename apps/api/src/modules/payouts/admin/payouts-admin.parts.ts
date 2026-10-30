import type { Provider, Type } from '@nestjs/common';
import { PayoutsOverviewSources } from '../../admin/overview/payouts.overview';
import { PayoutsModule } from '../payouts.module';
import { AdminPayoutsController } from './admin-payouts.controller';

/**
 * Stream B's part of the AdminModule (ADR-0026 D9): one spread each in admin.module.ts. The
 * controller is declared there so StaffGuard, AuditService and the idempotency store resolve.
 */
export const PAYOUTS_ADMIN_IMPORTS: Type[] = [PayoutsModule];
export const PAYOUTS_ADMIN_CONTROLLERS: Type[] = [AdminPayoutsController];
export const PAYOUTS_ADMIN_PROVIDERS: Provider[] = [PayoutsOverviewSources];

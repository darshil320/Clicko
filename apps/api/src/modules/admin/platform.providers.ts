import type { Provider, Type } from '@nestjs/common';
import { AdminAccountController } from './auth/admin-account.controller';
import { StaffPasswordService } from './auth/staff-password.service';
import { AdminOverviewController } from './overview/admin-overview.controller';
import { OpsOverviewSources } from './overview/ops-sources';
import { OverviewRegistry } from './overview/overview.registry';
import { OverviewService } from './overview/overview.service';

/**
 * Stream E's part of the AdminModule (ADR-0026 D9): Today (`GET /admin/overview`, its source
 * registry and the Sprint 9 sources) and the self-service password change (D7). One spread each
 * in admin.module.ts, so the shared module file takes one-line additions only.
 */
export const PLATFORM_CONTROLLERS: Type[] = [AdminOverviewController, AdminAccountController];

export const PLATFORM_PROVIDERS: Provider[] = [
  OverviewRegistry,
  OpsOverviewSources,
  OverviewService,
  StaffPasswordService,
];

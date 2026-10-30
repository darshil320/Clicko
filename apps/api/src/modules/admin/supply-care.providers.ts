import type { Provider, Type } from '@nestjs/common';
import { CareModule } from '../care/care.module';
import { AdminCareController } from './desks/admin-care.controller';
import { AdminSupplyController } from './desks/admin-supply.controller';
import { CareContext } from './desks/care-context';
import { ClaimDeskService } from './desks/claim-desk.service';
import { QualityIssuesDeskService } from './desks/quality-issues-desk.service';
import { StaffNames } from './desks/staff-names';
import { SupplyCareOverviewSources } from './desks/supply-care.overview';
import { SupplyDeskService } from './desks/supply-desk.service';
import { TicketDeskService } from './desks/ticket-desk.service';

/**
 * Stream C's part of the AdminModule (ADR-0026 D5/D6/D9): the photographers, quality issues,
 * support tickets and equipment claims desks. One spread each in admin.module.ts.
 */
export const SUPPLY_CARE_IMPORTS: Type[] = [CareModule];

export const SUPPLY_CARE_CONTROLLERS: Type[] = [AdminSupplyController, AdminCareController];

export const SUPPLY_CARE_PROVIDERS: Provider[] = [
  StaffNames,
  CareContext,
  SupplyDeskService,
  QualityIssuesDeskService,
  TicketDeskService,
  ClaimDeskService,
  SupplyCareOverviewSources,
];

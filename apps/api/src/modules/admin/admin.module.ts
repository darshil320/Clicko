import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { MediaModule } from '../media/media.module';
import { OnsiteModule } from '../onsite/onsite.module';
import { OpsModule } from '../ops/ops.module';
import { PaymentsModule } from '../payments/payments.module';
import {
  PAYOUTS_ADMIN_CONTROLLERS,
  PAYOUTS_ADMIN_IMPORTS,
  PAYOUTS_ADMIN_PROVIDERS,
} from '../payouts/admin/payouts-admin.parts';
import { PhotographersModule } from '../photographers/photographers.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { SlaModule } from '../sla/sla.module';
import { CityResolver } from './access/city-resolver';
import { CityScopeGuard } from './access/city-scope.guard';
import { StaffGuard } from './access/staff.guard';
import { CITY_RESOLVER, STAFF_ACCESS } from './access/staff-context';
import { AuditRepository } from './audit/audit.repository';
import { AuditService } from './audit/audit.service';
import { AuditLogInterceptor } from './audit/audit-log.interceptor';
import { AdminAuthController } from './auth/admin-auth.controller';
import { LoginStore } from './auth/login-store';
import { StaffAuthService } from './auth/staff-auth.service';
import { AdminBookingsController } from './desks/admin-bookings.controller';
import { AdminOpsController } from './desks/admin-ops.controller';
import { AlertFeedService } from './desks/alert-feed.service';
import { BookingBoardService } from './desks/booking-board.service';
import { BreachDeskService } from './desks/breach-desk.service';
import { DispatchQueueService } from './desks/dispatch-queue.service';
import { IncidentDeskService } from './desks/incident-desk.service';
import { QaDeskService } from './desks/qa-desk.service';
import { MONEY_CONTROLLERS, MONEY_IMPORTS, MONEY_PROVIDERS } from './money/money.providers';
import { PLATFORM_CONTROLLERS, PLATFORM_PROVIDERS } from './platform.providers';
import { PRICING_CONTROLLERS, PRICING_IMPORTS, PRICING_PROVIDERS } from './pricing.providers';
import { AdminStaffController } from './staff/admin-staff.controller';
import { StaffRepository } from './staff/staff.repository';
import { StaffService } from './staff/staff.service';
import {
  SUPPLY_CARE_CONTROLLERS,
  SUPPLY_CARE_IMPORTS,
  SUPPLY_CARE_PROVIDERS,
} from './supply-care.providers';

/**
 * The staff admin API (ADR-0025, doc 02 `modules/admin`). Owns staff_users, staff_role_grants and
 * audit_logs. The desks read and decide through the services of the modules that own the data
 * (bookings, dispatch, delivery, onsite, sla, ops, payments, photographers, serviceability,
 * media); this module never queries their tables.
 */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    BookingsModule,
    DispatchModule,
    DeliveryModule,
    OnsiteModule,
    SlaModule,
    OpsModule,
    PaymentsModule,
    PhotographersModule,
    ServiceabilityModule,
    MediaModule,
    ...PRICING_IMPORTS,
    ...MONEY_IMPORTS,
    ...SUPPLY_CARE_IMPORTS,
    ...PAYOUTS_ADMIN_IMPORTS,
  ],
  controllers: [
    AdminAuthController,
    AdminStaffController,
    AdminBookingsController,
    AdminOpsController,
    ...PLATFORM_CONTROLLERS,
    ...PRICING_CONTROLLERS,
    ...MONEY_CONTROLLERS,
    ...SUPPLY_CARE_CONTROLLERS,
    ...PAYOUTS_ADMIN_CONTROLLERS,
  ],
  providers: [
    ...PAYOUTS_ADMIN_PROVIDERS,
    StaffRepository,
    StaffService,
    { provide: STAFF_ACCESS, useExisting: StaffService },
    { provide: CITY_RESOLVER, useClass: CityResolver },
    AuditRepository,
    AuditService,
    AuditLogInterceptor,
    StaffGuard,
    CityScopeGuard,
    LoginStore,
    StaffAuthService,
    BookingBoardService,
    QaDeskService,
    IncidentDeskService,
    DispatchQueueService,
    BreachDeskService,
    AlertFeedService,
    ...PLATFORM_PROVIDERS,
    ...PRICING_PROVIDERS,
    ...MONEY_PROVIDERS,
    ...SUPPLY_CARE_PROVIDERS,
  ],
})
export class AdminModule {}

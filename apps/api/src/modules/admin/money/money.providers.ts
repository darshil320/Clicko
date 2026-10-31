import type { Provider, Type } from '@nestjs/common';
import { RefundsModule } from '../../refunds/refunds.module';
import { AdminMoneyController } from './admin-money.controller';
import { MoneyStepUp } from './money-step-up';
import { RefundDeskService } from './refund-desk.service';
import { ReviewDeskService } from './review-desk.service';
import { StaffNames } from './staff-names';

/**
 * Stream A's part of the AdminModule (ADR-0026 D9): the refund and "To settle" desks, credits and
 * breach remedies. One spread each in admin.module.ts.
 */
export const MONEY_IMPORTS: Type[] = [RefundsModule];
export const MONEY_CONTROLLERS: Type[] = [AdminMoneyController];
export const MONEY_PROVIDERS: Provider[] = [
  StaffNames,
  MoneyStepUp,
  RefundDeskService,
  ReviewDeskService,
];

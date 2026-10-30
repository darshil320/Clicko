import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';
import { SlaBreachesRepository } from '../../sla/repositories/sla-breaches.repository';
import { SlaDeskService } from '../../sla/sla-desk.service';
import type { AppliedBreachDeduction, BreachDeductionsPort } from '../ports';

/**
 * Breach facts for payouts. Deductions come from stream A's `SlaDeskService.appliedDeductions`
 * (ADR-0026 D2). The "under review" flag reads the breaches through the repository SlaModule
 * exports — swap for an SlaDeskService read if one is added.
 */
@Injectable()
export class SlaBreachesAdapter implements BreachDeductionsPort {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
    @Inject(SlaBreachesRepository) private readonly breaches: SlaBreachesRepository,
  ) {}

  applied(bookingIds: readonly string[]): Promise<AppliedBreachDeduction[]> {
    if (bookingIds.length === 0) return Promise.resolve([]);
    return this.sla.appliedDeductions(bookingIds);
  }

  async underReview(bookingIds: readonly string[]): Promise<Set<string>> {
    if (bookingIds.length === 0) return new Set();
    const rows = await this.breaches.forBookings(this.sql, bookingIds);
    return new Set(
      rows
        .filter(
          (b) => b.attributedTo === 'PHOTOGRAPHER' && b.appliedAt === null && b.waivedBy === null,
        )
        .map((b) => b.bookingId),
    );
  }
}

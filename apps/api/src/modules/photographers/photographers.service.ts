import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import type {
  AcceptAvailability,
  Db,
  NewPenalty,
  PhotographerIdentity,
  PoolCriteria,
  PoolMember,
} from './photographers.types';

/** v0.2 §9: 1st no-show → warning, 2nd → 7-day deactivation, 3rd → removal. */
const NO_SHOW_DEACTIVATION_DAYS = 7;

import { PhotographersRepository } from './repositories/photographers.repository';

/**
 * Owns the photographer tables (schema §6). Sprint 5 needs the read side only: who may be offered
 * a booking (dispatch), and who may sign in to the Pro app (PRO_LOGIN). Onboarding writes come with
 * the admin console.
 */
@Injectable()
export class PhotographersService {
  constructor(
    @Inject(PhotographersRepository) private readonly repo: PhotographersRepository,
    @Inject(SQL) private readonly sql: postgres.Sql,
  ) {}

  /** Every photographer passing the non-geographic hard filters (ADR-0010), in the caller's tx. */
  dispatchPool(db: Db, criteria: PoolCriteria): Promise<PoolMember[]> {
    return this.repo.dispatchPool(db, criteria);
  }

  /** Re-checked inside the accept transaction: still ACTIVE, no personal block in the window. */
  availabilityAt(db: Db, id: string, from: Date, until: Date): Promise<AcceptAvailability> {
    return this.repo.availabilityAt(db, id, from, until);
  }

  /**
   * Records a penalty in the caller's transaction (ADR-0012 D7). A no-show escalates by
   * occurrence (severity 1/2/3, 7 days at 2); a cancellation after acceptance is CONDUCT,
   * severity 1. Applying a deactivation and waivers are ops actions (S6/S9).
   */
  async recordPenalty(db: Db, p: NewPenalty): Promise<void> {
    if (p.kind === 'CONDUCT') {
      await this.repo.insertPenalty(db, { ...p, severity: 1, deactivationDays: null });
      return;
    }
    const severity = Math.min(
      (await this.repo.penaltyCount(db, p.photographerId, 'NO_SHOW')) + 1,
      3,
    );
    const deactivationDays = severity === 2 ? NO_SHOW_DEACTIVATION_DAYS : null;
    await this.repo.insertPenalty(db, { ...p, severity, deactivationDays });
  }

  findActiveByPhone(phone: string): Promise<PhotographerIdentity | null> {
    return this.repo.findActiveByPhone(this.sql, phone);
  }

  findActiveById(id: string): Promise<PhotographerIdentity | null> {
    return this.repo.findActiveById(this.sql, id);
  }

  /** Names for the ops dispatch desk (staff-facing; clients never see these). */
  displayNames(ids: readonly string[]): Promise<Map<string, string>> {
    return this.repo.displayNames(this.sql, ids);
  }
}

import { PHOTOGRAPHER_STATUS_ACTIONS, type PhotographerStatusAction } from '@clickco/contracts';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import type { IdSubquery } from '../../infra/db/id-subquery';
import { DirectoryRepository } from './repositories/directory.repository';
import { KycRepository } from './repositories/kyc.repository';
import type {
  CityScope,
  DirectoryFilter,
  DirectoryRecord,
  PenaltyRecord,
  ProfileRecord,
} from './supply.types';
import { covers, missingChecks, missingChecksMessage } from './supply-rules';

const NOT_FOUND = { code: 'PHOTOGRAPHER_NOT_FOUND', message: 'Photographer not found' };
const PENALTY_NOT_FOUND = { code: 'PENALTY_NOT_FOUND', message: 'Penalty not found' };

/**
 * The photographer directory (ADR-0026 D5): search, the profile (tier, categories, status,
 * metrics, penalties, documents), penalty waivers (ADR-0013: a verified emergency, a no-show
 * reversed after a late offline check-in) and status changes — each with its reason, in one
 * transaction with the audit row.
 */
@Injectable()
export class PhotographerDirectoryService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(DirectoryRepository) private readonly repo: DirectoryRepository,
    @Inject(KycRepository) private readonly kyc: KycRepository,
  ) {}

  page(filter: DirectoryFilter): Promise<DirectoryRecord[]> {
    return this.repo.page(this.sql, filter);
  }

  async profile(id: string, scope: CityScope): Promise<ProfileRecord> {
    const base = await this.repo.profileBase(this.sql, id);
    if (!base || !covers(scope, base.cityId)) throw new NotFoundException(NOT_FOUND);
    const [categories, metrics, penalties, documents, application] = await Promise.all([
      this.repo.categories(this.sql, id),
      this.repo.metrics(this.sql, id),
      this.repo.penalties(this.sql, id),
      this.kyc.documentsOf(this.sql, id),
      this.repo.latestApplication(this.sql, id),
    ]);
    return { ...base, categories, metrics, penalties, documents, application };
  }

  async waivePenalty(w: {
    readonly id: string;
    readonly reason: string;
    readonly scope: CityScope;
    readonly audit: TxHook;
  }): Promise<PenaltyRecord> {
    return this.sql.begin(async (tx) => {
      const penalty = await this.repo.lockPenalty(tx, w.id);
      if (!penalty || !covers(w.scope, penalty.cityId)) {
        throw new NotFoundException(PENALTY_NOT_FOUND);
      }
      if (penalty.waived) {
        throw new ConflictException({
          code: 'PENALTY_ALREADY_WAIVED',
          message: 'This penalty is already waived',
        });
      }
      const waived = await this.repo.waivePenalty(tx, w.id, w.reason);
      await w.audit(tx, {
        before: { waived: false, kind: penalty.kind, severity: penalty.severity },
        after: { waived: true, kind: penalty.kind, severity: penalty.severity, reason: w.reason },
      });
      return waived;
    });
  }

  async changeStatus(c: {
    readonly id: string;
    readonly action: PhotographerStatusAction;
    readonly reason: string;
    readonly scope: CityScope;
    readonly now: Date;
    readonly audit: TxHook;
  }): Promise<void> {
    const rule = PHOTOGRAPHER_STATUS_ACTIONS[c.action];
    await this.sql.begin(async (tx) => {
      const pro = await this.repo.lockPhotographer(tx, c.id);
      if (!pro || !covers(c.scope, pro.cityId)) throw new NotFoundException(NOT_FOUND);
      if (!rule.from.includes(pro.status)) {
        throw new ConflictException({
          code: 'STATUS_CHANGE_NOT_ALLOWED',
          message: `A ${pro.status.toLowerCase()} photographer cannot be moved to ${rule.to.toLowerCase()}`,
        });
      }
      if (rule.to === 'ACTIVE') {
        const missing = missingChecks(pro.verification);
        if (missing.length > 0) {
          throw new UnprocessableEntityException({
            code: 'VERIFICATION_INCOMPLETE',
            message: missingChecksMessage(missing),
            details: { missing },
          });
        }
      }
      await this.repo.setStatus(tx, c.id, { to: rule.to, reason: c.reason, at: c.now });
      await c.audit(tx, {
        before: { status: pro.status },
        after: { status: rule.to, action: c.action, reason: c.reason },
      });
    });
  }

  /** Photographer ids in these cities, for another module's SQL filter. */
  idsInScope(scope: CityScope): IdSubquery {
    return this.repo.idsInScope(this.sql, scope);
  }

  cityOf(id: string): Promise<string | null> {
    return this.repo.cityOf(this.sql, id);
  }

  idByPhone(phone: string): Promise<string | null> {
    return this.repo.idByPhone(this.sql, phone);
  }
}

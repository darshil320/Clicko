import {
  APPLICATION_BOARD_STAGES,
  APPLICATION_CLOSED_STAGES,
  APPLICATION_CLOSED_WINDOW_DAYS,
  APPLICATION_COLUMN_CAP,
  APPLICATION_DECISION_STAGES,
  type ApplicationStage,
  canMoveApplication,
} from '@clickco/contracts';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { KycRepository } from './repositories/kyc.repository';
import { OnboardingRepository } from './repositories/onboarding.repository';
import { FOREIGN_KEY_VIOLATION, sqlState, UNIQUE_VIOLATION } from './repositories/supply-rows';
import type {
  ApplicationCardRecord,
  ApplicationDetailRecord,
  BoardColumnRecord,
  CityScope,
  NewApplicant,
} from './supply.types';
import { covers, DAY_MS, missingChecks, missingChecksMessage } from './supply-rules';

const NOT_FOUND = { code: 'APPLICATION_NOT_FOUND', message: 'Application not found' };

export interface MoveInput {
  readonly id: string;
  readonly to: ApplicationStage;
  readonly note: string;
  readonly staffId: string;
  readonly scope: CityScope;
  /** Whether the caller may approve or reject in this city (city manager / SUPER_ADMIN). */
  readonly canDecide: (cityId: string) => boolean;
  readonly now: Date;
  readonly audit: TxHook;
}

/**
 * The onboarding kanban (ADR-0026 D5): photographer_applications moved stage by stage, each move
 * appended to photographer_application_events with its reason, in one transaction with the audit
 * row. Approval onboards the photographer (APPLICANT → ACTIVE) once the four checks are ticked.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(OnboardingRepository) private readonly repo: OnboardingRepository,
    @Inject(KycRepository) private readonly kyc: KycRepository,
  ) {}

  /** Every stage as a column (board stages first), longest-waiting cards first. */
  async board(q: {
    readonly scope: CityScope;
    readonly cityId?: string;
    readonly search?: string;
    readonly searchPhones: boolean;
    readonly now: Date;
  }): Promise<BoardColumnRecord[]> {
    const rows = await this.repo.board(this.sql, {
      scope: q.scope,
      ...(q.cityId ? { cityId: q.cityId } : {}),
      ...(q.search ? { search: q.search } : {}),
      searchPhones: q.searchPhones,
      boardStages: APPLICATION_BOARD_STAGES,
      closedStages: APPLICATION_CLOSED_STAGES,
      closedSince: new Date(q.now.getTime() - APPLICATION_CLOSED_WINDOW_DAYS * DAY_MS),
      perStage: APPLICATION_COLUMN_CAP,
    });
    const stages: readonly ApplicationStage[] = [
      ...APPLICATION_BOARD_STAGES,
      ...APPLICATION_CLOSED_STAGES,
    ];
    return stages.map((stage) => {
      const items = rows.filter((r) => r.stage === stage);
      return {
        stage,
        count: items[0]?.total ?? 0,
        items: items.map(({ total: _total, ...card }) => card),
      };
    });
  }

  async detail(id: string, scope: CityScope): Promise<ApplicationDetailRecord> {
    const card = await this.repo.card(this.sql, id);
    if (!card || !covers(scope, card.cityId)) throw new NotFoundException(NOT_FOUND);
    const [extras, history, documentList] = await Promise.all([
      this.repo.extras(this.sql, id),
      this.repo.history(this.sql, id),
      this.kyc.documentsOf(this.sql, card.photographerId),
    ]);
    if (!extras) throw new NotFoundException(NOT_FOUND);
    return { ...card, ...extras, documentList, history };
  }

  async move(m: MoveInput): Promise<ApplicationCardRecord> {
    await this.sql.begin(async (tx) => {
      const app = await this.repo.lock(tx, m.id);
      if (!app || !covers(m.scope, app.cityId)) throw new NotFoundException(NOT_FOUND);
      if (!canMoveApplication(app.stage, m.to)) {
        throw new ConflictException({
          code: 'APPLICATION_MOVE_NOT_ALLOWED',
          message:
            app.stage === 'APPROVED'
              ? 'This photographer is already onboarded. Change their status in the directory.'
              : `An application in ${app.stage} cannot move to ${m.to}`,
        });
      }
      const deciding = (APPLICATION_DECISION_STAGES as readonly ApplicationStage[]).includes(m.to);
      if (deciding && !m.canDecide(app.cityId)) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Only a city manager can approve or reject an application',
        });
      }
      if (m.to === 'APPROVED') {
        const missing = missingChecks(app.verification);
        if (missing.length > 0) {
          throw new UnprocessableEntityException({
            code: 'VERIFICATION_INCOMPLETE',
            message: missingChecksMessage(missing),
            details: { missing },
          });
        }
        if (app.photographerStatus === 'APPLICANT') {
          await this.repo.activateApplicant(tx, app.photographerId, m.now);
        }
      }
      if (m.to === 'APPROVED' || m.to === 'REJECTED') {
        await this.repo.setDecision(tx, m.id, {
          stage: m.to,
          reason: m.note,
          staffId: m.staffId,
          at: m.now,
        });
      } else {
        await this.repo.setStage(tx, m.id, m.to);
      }
      await this.repo.appendEvent(tx, {
        applicationId: m.id,
        from: app.stage,
        to: m.to,
        staffId: m.staffId,
        note: m.note,
        at: m.now,
      });
      await m.audit(tx, {
        before: { stage: app.stage, photographer_status: app.photographerStatus },
        after: {
          stage: m.to,
          note: m.note,
          photographer_status:
            m.to === 'APPROVED' && app.photographerStatus === 'APPLICANT'
              ? 'ACTIVE'
              : app.photographerStatus,
        },
      });
    });
    const card = await this.repo.card(this.sql, m.id);
    if (!card) throw new NotFoundException(NOT_FOUND);
    return card;
  }

  /** A walk-in / referral applicant: an APPLICANT photographer and an APPLIED application. */
  async createApplicant(c: {
    readonly applicant: NewApplicant;
    readonly staffId: string;
    readonly now: Date;
    readonly auditFor: (applicationId: string) => TxHook;
  }): Promise<ApplicationCardRecord> {
    let id: string;
    try {
      id = await this.sql.begin(async (tx) => {
        const applicationId = await this.repo.createApplicant(tx, c.applicant, c.now);
        await this.repo.appendEvent(tx, {
          applicationId,
          from: null,
          to: 'APPLIED',
          staffId: c.staffId,
          note: c.applicant.note,
          at: c.now,
        });
        await c.auditFor(applicationId)(tx, {
          before: null,
          after: {
            stage: 'APPLIED',
            full_name: c.applicant.fullName,
            city_id: c.applicant.cityId,
            source: c.applicant.source,
          },
        });
        return applicationId;
      });
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) {
        throw new ConflictException({
          code: 'PHOTOGRAPHER_EXISTS',
          message: 'A photographer with this phone number is already on file',
        });
      }
      if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
        throw new UnprocessableEntityException({
          code: 'UNKNOWN_CITY',
          message: 'Pick a city from the list',
        });
      }
      throw error;
    }
    const card = await this.repo.card(this.sql, id);
    if (!card) throw new NotFoundException(NOT_FOUND);
    return card;
  }

  /** Today: applications moving through the pipeline (not on hold) in these cities. */
  countWaiting(scope: CityScope): Promise<number> {
    return this.repo.countWaiting(
      this.sql,
      scope,
      APPLICATION_BOARD_STAGES.filter((s) => s !== 'ON_HOLD'),
    );
  }
}

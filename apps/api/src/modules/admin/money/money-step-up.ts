import type { CreditCoApprover, StaffRole } from '@clickco/contracts';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../../common/tx-hook';
import { SQL } from '../../../infra/db/db.module';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { STAFF_ACCESS, type StaffAccessPort } from '../access/staff-context';
import { StepUpService } from '../auth/step-up.service';
import { StaffRepository } from '../staff/staff.repository';

const UNLIMITED: readonly StaffRole[] = ['SUPER_ADMIN', 'FINANCE'];

const CO_APPROVER_INVALID = {
  code: 'CO_APPROVER_INVALID',
  message:
    'The second approver must be another active finance person or super admin who covers this city.',
};

/** Who may be named (ADR-0030 lets a second Quality Manager co-approve a data loss too). */
const CO_APPROVER_LABEL: ReadonlyArray<readonly [StaffRole, string]> = [
  ['QUALITY_MANAGER', 'Quality Manager'],
  ['FINANCE', 'finance person'],
  ['SUPER_ADMIN', 'super admin'],
];

function invalidCoApprover(roles: readonly StaffRole[]) {
  if (roles === UNLIMITED) return CO_APPROVER_INVALID;
  const names = CO_APPROVER_LABEL.filter(([r]) => roles.includes(r)).map(([, n]) => n);
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
  return {
    code: CO_APPROVER_INVALID.code,
    message: `The second approver must be another active ${who ?? 'approver'} who covers this city.`,
  };
}

/**
 * Step-up and four-eyes for the money desks (security audit, 31 Oct 2026):
 * - a refund approval above the Quality Manager's ceiling needs the approver's fresh
 *   authenticator code;
 * - a credit above CREDIT_FOUR_EYES_PAISE needs the issuer's code AND a second FINANCE /
 *   SUPER_ADMIN co-approving with their own code in the same request (audit L8).
 * A missing code is 422 STEP_UP_REQUIRED, so the panel can ask for it and explain why.
 */
@Injectable()
export class MoneyStepUp {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
    @Inject(StaffRepository) private readonly staff: StaffRepository,
    @Inject(STAFF_ACCESS) private readonly access: StaffAccessPort,
  ) {}

  /** The caller's own fresh code; `why` says in plain words why it is needed. */
  async requireCode(
    caller: StaffCaller,
    code: string | undefined,
    ctx: AuditContext,
    purpose: string,
    why: string,
  ): Promise<void> {
    if (!code) {
      throw new UnprocessableEntityException({ code: 'STEP_UP_REQUIRED', message: why });
    }
    await this.stepUp.verify(caller.id, code, ctx, purpose);
  }

  /**
   * A second person, by sign-in email: active, not the caller, holding one of `roles` (FINANCE or
   * SUPER_ADMIN unless the action says otherwise) covering `cityId` (null = needs an all-city
   * grant), proving it with their own fresh code. Resolves to their staff id.
   */
  async requireCoApprover(
    caller: StaffCaller,
    co: CreditCoApprover | undefined,
    cityId: string | null,
    ctx: AuditContext,
    purpose: string,
    why: string,
    roles: readonly StaffRole[] = UNLIMITED,
  ): Promise<string> {
    return (await this.coApprover(caller, co, cityId, ctx, purpose, why, roles)).id;
  }

  /**
   * As `requireCoApprover`, and whether that person also holds FINANCE or SUPER_ADMIN in the city
   * (ADR-0030: above the Quality Manager's ceiling only they may be the second person).
   */
  async coApprover(
    caller: StaffCaller,
    co: CreditCoApprover | undefined,
    cityId: string | null,
    ctx: AuditContext,
    purpose: string,
    why: string,
    roles: readonly StaffRole[] = UNLIMITED,
  ): Promise<{ readonly id: string; readonly unlimited: boolean }> {
    if (!co) {
      throw new UnprocessableEntityException({ code: 'STEP_UP_REQUIRED', message: why });
    }
    const record = await this.staff.findByEmail(this.sql, co.email);
    const principal = record ? await this.access.activePrincipal(record.id) : null;
    const coversWith = (allowed: readonly StaffRole[]) =>
      principal?.grants.some(
        (g) =>
          allowed.includes(g.role) &&
          (g.role === 'SUPER_ADMIN' ||
            g.cityId === null ||
            (cityId !== null && g.cityId === cityId)),
      ) ?? false;
    if (!principal || principal.id === caller.id || !coversWith(roles)) {
      throw new ForbiddenException(invalidCoApprover(roles));
    }
    await this.stepUp.verify(principal.id, co.code, ctx, `${purpose}.co_approve`);
    return { id: principal.id, unlimited: coversWith(UNLIMITED) };
  }
}

/** The audit row also names the co-approver (in the change's own transaction). */
export function withCoApprover(hook: TxHook, coApproverId: string | null): TxHook {
  if (coApproverId === null) return hook;
  return (tx, change) =>
    hook(tx, {
      before: change.before,
      after: { ...(change.after ?? {}), co_approved_by: coApproverId, step_up: 'TOTP' },
    });
}

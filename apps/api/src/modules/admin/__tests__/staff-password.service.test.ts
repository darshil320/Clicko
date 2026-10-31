import { HttpException, Logger } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import type { AuditContext } from '../access/staff-context';
import type { AuditService } from '../audit/audit.service';
import type { LoginStore } from '../auth/login-store';
import { STAFF_LOGIN_POLICY } from '../auth/login-store';
import { DEV_STAFF_TOTP_KEY, SecretBox } from '../auth/secret-box';
import { StaffPasswordService } from '../auth/staff-password.service';
import { newTotpSecret, totpAt } from '../auth/totp';
import type { StaffRecord, StaffRepository } from '../staff/staff.repository';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** An in-memory LoginStore whose every call yields, so parallel requests really interleave. */
class SlowStore {
  failures = 0;
  cleared = 0;
  usedSteps = new Set<number>();
  async totpFailures() {
    await tick();
    return this.failures;
  }
  async recordTotpFailure() {
    await tick();
    this.failures += 1;
    return this.failures;
  }
  async clearTotpFailures() {
    await tick();
    this.failures = 0;
    this.cleared += 1;
  }
  async claimStep(_id: string, step: number) {
    await tick();
    if (this.usedSteps.has(step)) return false;
    this.usedSteps.add(step);
    return true;
  }
}

function setup() {
  Logger.overrideLogger(false);
  const box = new SecretBox(DEV_STAFF_TOTP_KEY);
  const secret = newTotpSecret();
  const staff = { id: STAFF_ID, email: 'x@clickco.test', totpSecret: box.seal(secret, STAFF_ID) };
  const store = new SlowStore();
  const audit = { recordAlone: async () => undefined } as unknown as AuditService;
  const service = new StaffPasswordService(
    null as never,
    () => NOW,
    { STAFF_TOTP_KEY: DEV_STAFF_TOTP_KEY } as Env,
    {} as StaffRepository,
    store as unknown as LoginStore,
    {} as never,
    audit,
  );
  // checkCode is the unit under test (the full change() needs Postgres and scrypt).
  const checkCode = (code: string) =>
    (
      service as unknown as {
        checkCode(s: StaffRecord, code: string, ctx: AuditContext): Promise<void>;
      }
    ).checkCode(staff as StaffRecord, code, {} as AuditContext);
  return { store, checkCode, rightCode: totpAt(secret, NOW) };
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
};

describe('StaffPasswordService code check (security audit L6)', () => {
  it('L6: parallel wrong codes cannot exceed the per-account limit (counted before checking)', async () => {
    const { store, checkCode, rightCode } = setup();
    store.failures = STAFF_LOGIN_POLICY.maxTotpFailuresPerStaff - 1;
    const wrong = rightCode === '000000' ? '111111' : '000000';
    const statuses = await Promise.all(Array.from({ length: 5 }, () => statusOf(checkCode(wrong))));
    expect(statuses.filter((s) => s === 422)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
  });

  it('L6: a right code clears the count', async () => {
    const { store, checkCode, rightCode } = setup();
    store.failures = 3;
    expect(await statusOf(checkCode(rightCode))).toBe(200);
    expect(store.failures).toBe(0);
  });

  it('a wrong code stays counted', async () => {
    const { store, checkCode, rightCode } = setup();
    const wrong = rightCode === '000000' ? '111111' : '000000';
    expect(await statusOf(checkCode(wrong))).toBe(422);
    expect(store.failures).toBe(1);
  });
});

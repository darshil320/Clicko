import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { type OtpChallengeRow, PgOtpRepository } from '../repositories/otp.repository';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const HOUR_AGO = new Date(NOW.getTime() - 3_600_000);

const row = (ip: string | null, phone = `+9198${String(Math.random()).slice(2, 10)}`) =>
  ({
    id: randomUUID(),
    phone,
    codeHash: 'h'.repeat(64),
    purpose: 'LOGIN',
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    expiresAt: new Date(NOW.getTime() + 300_000),
    ip,
    createdAt: NOW,
  }) satisfies OtpChallengeRow;

describe.runIf(TEST_DATABASE_URL)('PgOtpRepository per-IP counting (security audit H1)', () => {
  let db: ScratchDb;
  let repo: PgOtpRepository;

  beforeAll(async () => {
    db = await createScratchDb();
    repo = new PgOtpRepository(db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it('H1: ::ffff:1.2.3.4 and ::ffff:5.6.7.8 are separate buckets', async () => {
    for (let i = 0; i < 20; i += 1) await repo.insert(row('::ffff:1.2.3.4'));
    expect(await repo.countForIpSince('::ffff:1.2.3.4', HOUR_AGO)).toBe(20);
    expect(await repo.countForIpSince('1.2.3.4', HOUR_AGO)).toBe(20);
    expect(await repo.countForIpSince('::ffff:5.6.7.8', HOUR_AGO)).toBe(0);
    expect(await repo.countForIpSince('5.6.7.8', HOUR_AGO)).toBe(0);
    expect(await repo.countForIpSince('1.2.3.5', HOUR_AGO)).toBe(0);
  });

  it('counts IPv6 per /64', async () => {
    await repo.insert(row('2001:db8:aa:1::1'));
    await repo.insert(row('2001:db8:aa:1:ffff::2'));
    await repo.insert(row('2001:db8:aa:2::1'));
    expect(await repo.countForIpSince('2001:db8:aa:1::99', HOUR_AGO)).toBe(2);
  });

  it('H1: requests without a usable IP share one bucket, and garbage never reaches the inet cast', async () => {
    await repo.insert(row('not-an-ip'));
    await repo.insert(row(null));
    expect(await repo.countForIpSince(null, HOUR_AGO)).toBe(2);
    expect(await repo.countForIpSince('garbage', HOUR_AGO)).toBe(2);
    await expect(
      repo.withLocks('+919800000001', "x'; DROP TABLE otp_challenges; --", async (r) =>
        r.countForIpSince("x'; --", HOUR_AGO),
      ),
    ).resolves.toBe(2);
  });
});

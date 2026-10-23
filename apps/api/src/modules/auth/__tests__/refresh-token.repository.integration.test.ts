import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { PgRefreshTokenRepository } from '../repositories/refresh-token.repository';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const GRACE_MS = 30_000;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

describe.runIf(TEST_DATABASE_URL)('PgRefreshTokenRepository.rotate in Postgres', () => {
  let db: ScratchDb;
  let repo: PgRefreshTokenRepository;

  beforeAll(async () => {
    db = await createScratchDb();
    repo = new PgRefreshTokenRepository(db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  const subject = randomUUID();
  const fresh = (token: string, at: Date, deviceId: string | null = null) => ({
    id: randomUUID(),
    tokenHash: hash(token),
    deviceId,
    revokedAt: null,
    expiresAt: new Date(at.getTime() + 86_400_000),
    createdAt: at,
  });
  const live = async () =>
    (
      await db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM refresh_tokens
        WHERE subject_id = ${subject} AND revoked_at IS NULL`
    )[0]?.n;

  it('carries the device id from the old token when the replacement has none', async () => {
    await repo.insert({
      ...fresh('t1', NOW, 'pixel-7'),
      subjectKind: 'PHOTOGRAPHER',
      subjectId: subject,
    });
    const next = fresh('t2', NOW);
    expect(await repo.rotate(hash('t1'), NOW, next, GRACE_MS, 'PHOTOGRAPHER')).toMatchObject({
      outcome: 'ROTATED',
      subjectKind: 'PHOTOGRAPHER',
    });
    const [row] = await db.sql<{ device_id: string | null }[]>`
      SELECT device_id FROM refresh_tokens WHERE token_hash = ${next.tokenHash}`;
    expect(row?.device_id).toBe('pixel-7');
  });

  it('a replay inside the grace window is GRACE and logs nobody out', async () => {
    const at = new Date(NOW.getTime() + GRACE_MS - 1);
    expect(await repo.rotate(hash('t1'), at, fresh('t3', at), GRACE_MS, 'PHOTOGRAPHER')).toEqual({
      outcome: 'GRACE',
    });
    expect(await live()).toBe(1);
  });

  it('a replay after the grace window is theft: every session of the subject is revoked', async () => {
    const at = new Date(NOW.getTime() + GRACE_MS + 1);
    expect(await repo.rotate(hash('t1'), at, fresh('t4', at), GRACE_MS, 'PHOTOGRAPHER')).toEqual({
      outcome: 'REUSED',
    });
    expect(await live()).toBe(0);
  });

  it('a token of another subject kind is NOT_FOUND and is not consumed', async () => {
    const other = randomUUID();
    await repo.insert({ ...fresh('u1', NOW), subjectKind: 'USER', subjectId: other });
    expect(await repo.rotate(hash('u1'), NOW, fresh('u2', NOW), GRACE_MS, 'PHOTOGRAPHER')).toEqual({
      outcome: 'NOT_FOUND',
    });
    const [row] = await db.sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM refresh_tokens WHERE token_hash = ${hash('u1')}`;
    expect(row?.revoked_at).toBeNull();
  });
});

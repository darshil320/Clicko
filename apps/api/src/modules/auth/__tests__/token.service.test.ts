import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  RefreshTokenRepository,
  RefreshTokenRow,
  UnboundRefreshToken,
} from '../repositories/refresh-token.repository';
import { TOKEN_POLICY, TokenService } from '../token.service';

const SECRET = 's'.repeat(32);
const USER = '0e9a4c55-3b8b-4f1e-8a56-0b1b2a6c9d10';

class FakeRefreshRepo implements RefreshTokenRepository {
  rows: RefreshTokenRow[] = [];
  async insert(row: RefreshTokenRow) {
    this.rows = [...this.rows, row];
  }
  async rotate(tokenHash: string, now: Date, replacement: UnboundRefreshToken) {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    if (!row) return { outcome: 'NOT_FOUND' as const };
    if (row.revokedAt && now.getTime() - row.revokedAt.getTime() <= TOKEN_POLICY.rotationGraceMs) {
      return { outcome: 'GRACE' as const };
    }
    if (row.revokedAt) {
      this.rows = this.rows.map((r) =>
        r.subjectId === row.subjectId && !r.revokedAt ? { ...r, revokedAt: now } : r,
      );
      return { outcome: 'REUSED' as const };
    }
    if (row.expiresAt <= now) return { outcome: 'EXPIRED' as const };
    this.rows = [
      ...this.rows.map((r) => (r === row ? { ...r, revokedAt: now } : r)),
      {
        ...replacement,
        subjectId: row.subjectId,
        subjectKind: row.subjectKind,
        deviceId: row.deviceId,
      },
    ];
    return { outcome: 'ROTATED' as const, subjectId: row.subjectId, subjectKind: row.subjectKind };
  }
  async revokeAllForSubject(kind: string, id: string, now: Date) {
    this.rows = this.rows.map((r) =>
      r.subjectKind === kind && r.subjectId === id && !r.revokedAt ? { ...r, revokedAt: now } : r,
    );
  }
  async revoke(tokenHash: string, now: Date) {
    this.rows = this.rows.map((r) =>
      r.tokenHash === tokenHash && !r.revokedAt ? { ...r, revokedAt: now } : r,
    );
  }
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
  return 200;
};

describe('TokenService', () => {
  let now: Date;
  let repo: FakeRefreshRepo;
  let tokens: TokenService;

  beforeEach(() => {
    now = new Date('2026-11-02T10:00:00.000Z');
    repo = new FakeRefreshRepo();
    tokens = new TokenService(repo, () => now, SECRET);
  });

  it('issues an access token that verifies back to the user', async () => {
    const pair = await tokens.issue({ kind: 'USER', id: USER }, 'device-1');
    await expect(tokens.verifyAccess(pair.accessToken)).resolves.toEqual({
      kind: 'USER',
      id: USER,
    });
    expect(pair.accessTokenExpiresAt).toBe(
      new Date(now.getTime() + TOKEN_POLICY.accessTtlMs).toISOString(),
    );
  });

  it('stores only a hash of the refresh token', async () => {
    const pair = await tokens.issue({ kind: 'USER', id: USER }, null);
    expect(repo.rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.rows[0]?.tokenHash).not.toBe(pair.refreshToken);
  });

  it('rejects an expired access token', async () => {
    const pair = await tokens.issue({ kind: 'USER', id: USER }, null);
    now = new Date(now.getTime() + TOKEN_POLICY.accessTtlMs + 1000);
    expect(await statusOf(tokens.verifyAccess(pair.accessToken))).toBe(401);
  });

  it('rejects a token signed with another secret, and garbage', async () => {
    const other = new TokenService(repo, () => now, 'x'.repeat(32));
    const forged = await other.issue({ kind: 'USER', id: USER }, null);
    expect(await statusOf(tokens.verifyAccess(forged.accessToken))).toBe(401);
    expect(await statusOf(tokens.verifyAccess('not-a-jwt'))).toBe(401);
  });

  it('rotates a refresh token: the new one works, the old one does not', async () => {
    const first = await tokens.issue({ kind: 'USER', id: USER }, null);
    const second = await tokens.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(tokens.verifyAccess(second.accessToken)).resolves.toEqual({
      kind: 'USER',
      id: USER,
    });
  });

  it('treats reuse of a rotated refresh token as theft and revokes every session', async () => {
    const first = await tokens.issue({ kind: 'USER', id: USER }, null);
    const second = await tokens.refresh(first.refreshToken);
    now = new Date(now.getTime() + TOKEN_POLICY.rotationGraceMs + 1);
    expect(await statusOf(tokens.refresh(first.refreshToken))).toBe(401);
    expect(await statusOf(tokens.refresh(second.refreshToken))).toBe(401);
  });

  it('rejects an expired or unknown refresh token', async () => {
    const pair = await tokens.issue({ kind: 'USER', id: USER }, null);
    expect(await statusOf(tokens.refresh('A'.repeat(43)))).toBe(401);
    now = new Date(now.getTime() + TOKEN_POLICY.refreshTtlMs + 1);
    expect(await statusOf(tokens.refresh(pair.refreshToken))).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const pair = await tokens.issue({ kind: 'USER', id: USER }, null);
    await tokens.revoke(pair.refreshToken);
    expect(await statusOf(tokens.refresh(pair.refreshToken))).toBe(401);
  });

  it('refuses a duplicate refresh inside the grace window without logging the user out everywhere', async () => {
    const first = await tokens.issue({ kind: 'USER', id: USER }, null);
    const second = await tokens.refresh(first.refreshToken);
    expect(await statusOf(tokens.refresh(first.refreshToken))).toBe(401);
    expect(await statusOf(tokens.refresh(second.refreshToken))).toBe(200);
  });

  it('keeps the device id across rotations', async () => {
    const first = await tokens.issue({ kind: 'USER', id: USER }, 'pixel-7');
    await tokens.refresh(first.refreshToken);
    expect(repo.rows.map((r) => r.deviceId)).toEqual(['pixel-7', 'pixel-7']);
  });

  it('revokes every session of a subject', async () => {
    const a = await tokens.issue({ kind: 'USER', id: USER }, 'a');
    const b = await tokens.issue({ kind: 'USER', id: USER }, 'b');
    await tokens.revokeAll({ kind: 'USER', id: USER });
    expect(await statusOf(tokens.refresh(a.refreshToken))).toBe(401);
    expect(await statusOf(tokens.refresh(b.refreshToken))).toBe(401);
  });

  it('rejects a token without an expiry or with the wrong token type', async () => {
    const { SignJWT } = await import('jose');
    const key = new TextEncoder().encode(SECRET);
    const noExp = await new SignJWT({ kind: 'USER' })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(USER)
      .setIssuer(TOKEN_POLICY.issuer)
      .setAudience(TOKEN_POLICY.audience)
      .setIssuedAt()
      .sign(key);
    expect(await statusOf(tokens.verifyAccess(noExp))).toBe(401);
    const wrongType = await new SignJWT({ kind: 'USER' })
      .setProtectedHeader({ alg: 'HS256', typ: 'link+jwt' })
      .setSubject(USER)
      .setIssuer(TOKEN_POLICY.issuer)
      .setAudience(TOKEN_POLICY.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expect(await statusOf(tokens.verifyAccess(wrongType))).toBe(401);
  });
});

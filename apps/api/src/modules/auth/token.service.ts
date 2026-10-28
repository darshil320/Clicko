import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { TokenPair } from '@clickco/contracts';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { CLOCK, type Clock } from '../../common/clock';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
  type SubjectKind,
} from './repositories/refresh-token.repository';

export const JWT_SECRET = Symbol('JWT_SECRET');

export const TOKEN_POLICY = {
  accessTtlMs: 15 * 60 * 1000,
  /** Clients and photographers: 30 days, sliding (each rotation starts a new 30 days). */
  refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
  /**
   * Staff (ADR-0025 D2): 12 h, fixed from sign-in — rotation keeps the original expiry, so a
   * staff session never outlives a working day without a fresh password + TOTP.
   */
  staffRefreshTtlMs: 12 * 60 * 60 * 1000,
  /**
   * Staff: a refresh token unused for 60 min is refused (security review M2). The panel refreshes
   * every ≤15 min while open, so only a closed or abandoned tab — or a lifted token — hits this.
   */
  staffIdleMs: 60 * 60 * 1000,
  /** A refresh token replayed this soon after rotation is a client retry, not theft. */
  rotationGraceMs: 30 * 1000,
  tokenType: 'at+jwt',
  issuer: 'clickco-api',
  audience: 'clickco',
} as const;

export interface Subject {
  readonly kind: SubjectKind;
  readonly id: string;
}

const SUBJECT_KINDS: readonly SubjectKind[] = ['USER', 'PHOTOGRAPHER', 'STAFF'];
const SESSION_INVALID = { code: 'SESSION_INVALID', message: 'Please sign in again' };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const refreshTtlMs = (kind: SubjectKind): number =>
  kind === 'STAFF' ? TOKEN_POLICY.staffRefreshTtlMs : TOKEN_POLICY.refreshTtlMs;

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly repo: RefreshTokenRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JWT_SECRET) secret: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(subject: Subject, deviceId: string | null): Promise<TokenPair> {
    const now = this.clock();
    const refresh = this.newRefresh(now, deviceId, subject.kind);
    await this.repo.insert({ ...refresh.row, subjectKind: subject.kind, subjectId: subject.id });
    return this.pair(subject, now, refresh.token, refresh.row.expiresAt);
  }

  /** `expectedKind` scopes the route: another kind's token is SESSION_INVALID and not consumed. */
  async refresh(
    refreshToken: string,
    expectedKind: SubjectKind,
  ): Promise<TokenPair & { subject: Subject }> {
    const now = this.clock();
    const next = this.newRefresh(now, null, expectedKind);
    const result = await this.repo.rotate(
      sha256(refreshToken),
      now,
      next.row,
      TOKEN_POLICY.rotationGraceMs,
      expectedKind,
      expectedKind === 'STAFF',
      expectedKind === 'STAFF' ? TOKEN_POLICY.staffIdleMs : null,
    );
    if (result.outcome !== 'ROTATED') throw new UnauthorizedException(SESSION_INVALID);
    const subject: Subject = { kind: result.subjectKind, id: result.subjectId };
    return { ...(await this.pair(subject, now, next.token, result.expiresAt)), subject };
  }

  /** Ends every session for a subject (blocked account, suspected theft). */
  async revokeAll(subject: Subject): Promise<void> {
    await this.repo.revokeAllForSubject(subject.kind, subject.id, this.clock());
  }

  /** Sign-out. Returns whose live token it was (null when unknown or already revoked). */
  async revoke(refreshToken: string): Promise<Subject | null> {
    return this.repo.revoke(sha256(refreshToken), this.clock());
  }

  async verifyAccess(token: string): Promise<Subject> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: TOKEN_POLICY.issuer,
        audience: TOKEN_POLICY.audience,
        algorithms: ['HS256'],
        typ: TOKEN_POLICY.tokenType,
        requiredClaims: ['exp', 'iat', 'sub'],
        currentDate: this.clock(),
      });
      const kind = payload.kind as SubjectKind;
      if (!payload.sub || !SUBJECT_KINDS.includes(kind)) throw new Error('malformed claims');
      return { kind, id: payload.sub };
    } catch {
      throw new UnauthorizedException(SESSION_INVALID);
    }
  }

  private newRefresh(now: Date, deviceId: string | null, kind: SubjectKind) {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      row: {
        id: randomUUID(),
        tokenHash: sha256(token),
        deviceId,
        revokedAt: null,
        expiresAt: new Date(now.getTime() + refreshTtlMs(kind)),
        createdAt: now,
      },
    };
  }

  private async pair(
    subject: Subject,
    now: Date,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<TokenPair> {
    const accessExpiresAt = new Date(now.getTime() + TOKEN_POLICY.accessTtlMs);
    const accessToken = await new SignJWT({ kind: subject.kind })
      .setProtectedHeader({ alg: 'HS256', typ: TOKEN_POLICY.tokenType })
      .setSubject(subject.id)
      .setIssuer(TOKEN_POLICY.issuer)
      .setAudience(TOKEN_POLICY.audience)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(accessExpiresAt.getTime() / 1000))
      .sign(this.key);
    return {
      accessToken,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    };
  }
}

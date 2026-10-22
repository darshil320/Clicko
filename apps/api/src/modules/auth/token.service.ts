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
  refreshTtlMs: 30 * 24 * 60 * 60 * 1000,
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
    const refresh = this.newRefresh(now, deviceId);
    await this.repo.insert({ ...refresh.row, subjectKind: subject.kind, subjectId: subject.id });
    return this.pair(subject, now, refresh.token, refresh.row.expiresAt);
  }

  async refresh(refreshToken: string): Promise<TokenPair & { subject: Subject }> {
    const now = this.clock();
    const next = this.newRefresh(now, null);
    const result = await this.repo.rotate(
      sha256(refreshToken),
      now,
      next.row,
      TOKEN_POLICY.rotationGraceMs,
    );
    if (result.outcome !== 'ROTATED') throw new UnauthorizedException(SESSION_INVALID);
    const subject: Subject = { kind: result.subjectKind, id: result.subjectId };
    return { ...(await this.pair(subject, now, next.token, next.row.expiresAt)), subject };
  }

  /** Ends every session for a subject (blocked account, suspected theft). */
  async revokeAll(subject: Subject): Promise<void> {
    await this.repo.revokeAllForSubject(subject.kind, subject.id, this.clock());
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.repo.revoke(sha256(refreshToken), this.clock());
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

  private newRefresh(now: Date, deviceId: string | null) {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      row: {
        id: randomUUID(),
        tokenHash: sha256(token),
        deviceId,
        revokedAt: null,
        expiresAt: new Date(now.getTime() + TOKEN_POLICY.refreshTtlMs),
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

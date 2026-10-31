import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ipBucket } from '../../../common/http/client-ip';
import { ENV, type Env } from '../../../config/env';
import { REDIS } from '../../../infra/queues/redis';

/** ADR-0025 D2 numbers in one place. */
export const STAFF_LOGIN_POLICY = {
  challengeTtlMs: 5 * 60 * 1000,
  /** Wrong TOTP codes before the challenge is burnt (the password must be entered again). */
  maxTotpAttempts: 5,
  /**
   * Audit M2: the hard lockout (429) is per email AND client network (IPv4 address / IPv6 /64),
   * so an attacker elsewhere cannot lock the real owner out; plus a per-IP ceiling across emails.
   */
  maxFailuresPerEmailIp: 5,
  maxFailuresPerIp: 20,
  /**
   * Per email across every network is a SIGNAL, not a lock: past it each attempt is slowed
   * (progressive delay) and the first crossing is audited and alerted.
   */
  emailSignalThreshold: 5,
  emailDelayBaseMs: 250,
  emailDelayMaxMs: 4_000,
  failureWindowMs: 15 * 60 * 1000,
  /** Wrong codes per staff account across challenges, then no new challenge (anti brute force). */
  maxTotpFailuresPerStaff: 10,
  /** Longer than the ±1-step acceptance window (90 s), so a used step stays refused. */
  usedStepTtlMs: 2 * 60 * 1000,
} as const;

export type ChallengeStep = 'TOTP' | 'ENROL_TOTP';

export interface StoredChallenge {
  readonly staffId: string;
  readonly step: ChallengeStep;
  /** ENROL_TOTP: the new secret, sealed for this staff id, saved only once a code proves it. */
  readonly pendingSecret: string | null;
  /** ADR-0026 D7: signed in with a temporary password; the code step must carry a new one. */
  readonly mustChangePassword: boolean;
  /**
   * A fingerprint of the password hash the challenge was earned with: a reset or change in
   * between makes the challenge worthless (see `passwordFingerprint`).
   */
  readonly passwordFingerprint: string;
}

/** A one-way, non-reversible tag of a stored password hash (never the hash itself). */
export const passwordFingerprint = (passwordHash: string): string =>
  createHash('sha256').update(`staff-challenge:${passwordHash}`).digest('base64url');

/** Refuses a step at or before the last one used: a code works once (RFC 6238 §5.2). */
const CLAIM_STEP = `
local last = tonumber(redis.call('get', KEYS[1]) or '-1')
if tonumber(ARGV[1]) <= last then return 0 end
redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1`;

/** Counts an attempt on a live challenge; returns the new count (0 = no such challenge). */
const ATTEMPT_CHALLENGE = `
if redis.call('exists', KEYS[1]) == 0 then return 0 end
return redis.call('hincrby', KEYS[1], 'attempts', 1)`;

/** INCR every key (expiry set once per window); returns the new counts. Atomic per call. */
const COUNT = `
local out = {}
for i, key in ipairs(KEYS) do
  out[i] = redis.call('incr', key)
  redis.call('pexpire', key, ARGV[1], 'NX')
end
return out`;

/** Gives back a reserved attempt (a correct password is not a failure). Never below zero. */
const RELEASE = `
for _, key in ipairs(KEYS) do
  if tonumber(redis.call('get', key) or '0') > 0 then redis.call('decr', key) end
end
return 1`;

const hashEmail = (email: string): string =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** IPv6 counts per /64, IPv4 per address (`::ffff:` stripped — audit H1); see common/http. */
export { ipBucket };

/**
 * Sign-in state in Redis (ADR-0025 D2): the 5-minute challenge bound to the staff id, lockout
 * counters (emails are hashed, never stored), and the per-staff TOTP replay guard. Keys live
 * under QUEUE_PREFIX like every other Redis key of this deployment.
 */
@Injectable()
export class LoginStore {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Counts this password attempt against (email, IP), the IP and the email BEFORE the password is
   * checked (atomic, so parallel requests cannot all slip under the limit). Returns the counts
   * including it; `release` gives it back when the password was right.
   */
  async reserve(
    email: string,
    ip: string | null,
  ): Promise<{ emailIp: number; ip: number; email: number }> {
    const [byEmailIp, byIp, byEmail] = (await this.redis.eval(
      COUNT,
      3,
      this.emailIpKey(email, ip),
      this.ipKey(ip),
      this.emailKey(email),
      String(STAFF_LOGIN_POLICY.failureWindowMs),
    )) as [number, number, number];
    return { emailIp: Number(byEmailIp), ip: Number(byIp), email: Number(byEmail) };
  }

  async release(email: string, ip: string | null): Promise<void> {
    await this.redis.eval(
      RELEASE,
      3,
      this.emailIpKey(email, ip),
      this.ipKey(ip),
      this.emailKey(email),
    );
  }

  /** Clears the email's failure counts on every network (a password reset, a good sign-in). */
  async clearEmail(email: string): Promise<void> {
    const pattern = `${this.key(`fail:email-ip:${hashEmail(email)}`)}:*`;
    const keys: string[] = [this.emailKey(email)];
    let cursor = '0';
    do {
      const [next, found] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      keys.push(...found);
      cursor = next;
    } while (cursor !== '0');
    await this.redis.del(...keys);
  }

  async totpFailures(staffId: string): Promise<number> {
    return Number((await this.redis.get(this.key(`fail:totp:${staffId}`))) ?? 0);
  }

  /**
   * A wrong code counts against the account only: the password before it is already limited per
   * (email, IP) and per IP, and typos must not lock out everyone behind one office NAT.
   */
  /** Returns the count including this one (atomic), so callers can count before checking. */
  async recordTotpFailure(staffId: string): Promise<number> {
    const [count] = (await this.redis.eval(
      COUNT,
      1,
      this.key(`fail:totp:${staffId}`),
      String(STAFF_LOGIN_POLICY.failureWindowMs),
    )) as [number];
    return Number(count);
  }

  async clearTotpFailures(staffId: string): Promise<void> {
    await this.redis.del(this.key(`fail:totp:${staffId}`));
  }

  async saveChallenge(id: string, c: StoredChallenge): Promise<void> {
    const key = this.key(`challenge:${id}`);
    await this.redis
      .multi()
      .hset(key, {
        staffId: c.staffId,
        step: c.step,
        pendingSecret: c.pendingSecret ?? '',
        mustChangePassword: c.mustChangePassword ? '1' : '0',
        passwordFingerprint: c.passwordFingerprint,
        attempts: '0',
      })
      .pexpire(key, STAFF_LOGIN_POLICY.challengeTtlMs)
      .exec();
  }

  async getChallenge(id: string): Promise<StoredChallenge | null> {
    const h = await this.redis.hgetall(this.key(`challenge:${id}`));
    if (!h.staffId || (h.step !== 'TOTP' && h.step !== 'ENROL_TOTP')) return null;
    if (!h.passwordFingerprint) return null;
    return {
      staffId: h.staffId,
      step: h.step,
      pendingSecret: h.pendingSecret || null,
      mustChangePassword: h.mustChangePassword === '1',
      passwordFingerprint: h.passwordFingerprint,
    };
  }

  /** Counts a code attempt (atomic); returns the count including it, 0 when the challenge is gone. */
  async attemptChallenge(id: string): Promise<number> {
    return Number(await this.redis.eval(ATTEMPT_CHALLENGE, 1, this.key(`challenge:${id}`)));
  }

  /** Atomic consume: true for exactly one caller. */
  async deleteChallenge(id: string): Promise<boolean> {
    return (await this.redis.del(this.key(`challenge:${id}`))) === 1;
  }

  /** false when this step (or a later one) was already used by this staff member. */
  async claimStep(staffId: string, step: number): Promise<boolean> {
    const reply = await this.redis.eval(
      CLAIM_STEP,
      1,
      this.key(`totp-step:${staffId}`),
      String(step),
      String(STAFF_LOGIN_POLICY.usedStepTtlMs),
    );
    return Number(reply) === 1;
  }

  private emailKey(email: string): string {
    return this.key(`fail:email:${hashEmail(email)}`);
  }

  private emailIpKey(email: string, ip: string | null): string {
    return this.key(`fail:email-ip:${hashEmail(email)}:${ipBucket(ip)}`);
  }

  private ipKey(ip: string | null): string {
    return this.key(`fail:ip:${ipBucket(ip)}`);
  }

  private key(suffix: string): string {
    return `${this.env.QUEUE_PREFIX}:staff-auth:${suffix}`;
  }
}

import type {
  ProOtpVerifyBody,
  ProVerifyOtpResponse,
  VerifyOtpBody,
  VerifyOtpResponse,
} from '@clickco/contracts';
import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { PhotographersService } from '../photographers/photographers.service';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp.service';
import { consentRequired, currentConsent, recordSignInConsent } from './sign-in-consent';
import { TokenService } from './token.service';

const INVALID_CODE = { code: 'OTP_INVALID', message: 'The code is invalid or has expired' };
const ACCOUNT_BLOCKED = { code: 'ACCOUNT_BLOCKED', message: 'This account is blocked' };

/**
 * OTP sign-in for both apps. Consent (DPDP s.6, s.9) is checked once the code is known to be right
 * but before it is used up, so CONSENT_REQUIRED leaves the code usable and only reaches the
 * holder of the phone (it cannot reveal whether a number has an account). The session, a new
 * account and the consent-log event commit in one transaction.
 */
@Injectable()
export class SignInService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
  ) {}

  /** Client app: a number without a live account (never used, or deleted) creates one. */
  async client(body: VerifyOtpBody): Promise<VerifyOtpResponse> {
    const { phone } = body;
    const consent = currentConsent(body.consent);
    await this.otp.verify(body.challengeId, phone, 'LOGIN', body.code, async () => {
      if (!consent && !(await this.users.hasLiveAccount(phone))) throw consentRequired();
    });
    return this.sql.begin(async (tx) => {
      const { user, isNew } = await this.users.findOrCreateByPhone(phone, tx);
      // The account was deleted between the check and here: refuse, rolling the insert back.
      if (isNew && !consent) throw consentRequired();
      if (user.isBlocked) throw new ForbiddenException(ACCOUNT_BLOCKED);
      const pair = await this.tokens.issue(
        { kind: 'USER', id: user.id },
        body.deviceId ?? null,
        tx,
      );
      if (consent) {
        await recordSignInConsent(tx, { kind: 'user', id: user.id }, consent, this.clock());
      }
      return { ...pair, user: { id: user.id, phone: user.phone, fullName: user.fullName, isNew } };
    });
  }

  /**
   * Pro app (ADR-0010): ACTIVE photographers only, and a photographer account is never created
   * here — so consent is required on a photographer's first sign-in. A number that is not an
   * active photographer still fails with OTP_INVALID, exactly like a wrong code.
   */
  async pro(body: ProOtpVerifyBody): Promise<ProVerifyOtpResponse> {
    const { phone } = body;
    const consent = currentConsent(body.consent);
    await this.otp.verify(body.challengeId, phone, 'PRO_LOGIN', body.code, async () => {
      if (consent) return;
      const active = await this.photographers.findActiveByPhone(phone);
      if (
        active &&
        !(await this.tokens.hasSignedInBefore({ kind: 'PHOTOGRAPHER', id: active.id }))
      ) {
        throw consentRequired();
      }
    });
    const photographer = await this.photographers.findActiveByPhone(phone);
    if (!photographer) throw new UnauthorizedException(INVALID_CODE);
    return this.sql.begin(async (tx) => {
      const subject = { kind: 'PHOTOGRAPHER', id: photographer.id } as const;
      const pair = await this.tokens.issue(subject, body.deviceId ?? null, tx);
      if (consent) {
        await recordSignInConsent(
          tx,
          { kind: 'photographer', id: photographer.id },
          consent,
          this.clock(),
        );
      }
      return {
        ...pair,
        photographer: {
          id: photographer.id,
          displayName: photographer.fullName,
          cityId: photographer.cityId,
        },
      };
    });
  }
}

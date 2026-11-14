import { ProOtpRequestBody, ProOtpVerifyBody, RefreshBody } from '@clickco/contracts';
import { Body, Controller, ForbiddenException, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ok } from '../../common/envelope';
import { clientIp } from '../../common/http/client-ip';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PhotographersService } from '../photographers/photographers.service';
import { OtpService } from './otp.service';
import { SignInService } from './sign-in.service';
import { TokenService } from './token.service';

/**
 * Photographer sign-in (ADR-0010): PRO_LOGIN OTP → a PHOTOGRAPHER session, for ACTIVE
 * photographers only. A number that is not an active photographer gets the identical response
 * and rate limits (the challenge is stored, the SMS is never sent), and its verify fails with the
 * same OTP_INVALID as a wrong code — so the endpoint cannot be used to discover who works for us.
 */
@Controller('pro/auth')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class ProAuthController {
  constructor(
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(SignInService) private readonly signIn: SignInService,
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(
    @Body(new ZodValidationPipe(ProOtpRequestBody)) body: ProOtpRequestBody,
    @Ip() ip: string,
  ) {
    const active = await this.photographers.findActiveByPhone(body.phone);
    return ok(await this.otp.request(body.phone, 'PRO_LOGIN', clientIp(ip), active !== null));
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body(new ZodValidationPipe(ProOtpVerifyBody)) body: ProOtpVerifyBody) {
    return ok(await this.signIn.pro(body));
  }

  /** Rotates a photographer session; a paused/suspended photographer loses every session. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(RefreshBody)) body: RefreshBody) {
    const { subject, ...pair } = await this.tokens.refresh(body.refreshToken, 'PHOTOGRAPHER');
    if (!(await this.photographers.findActiveById(subject.id))) {
      await this.tokens.revokeAll(subject);
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account is not active — contact Clickco support',
      });
    }
    return ok(pair);
  }

  /** Sign-out: the refresh token stops working at once (security review M7). Always 200. */
  @Post('logout')
  @HttpCode(200)
  async logout(@Body(new ZodValidationPipe(RefreshBody)) body: RefreshBody) {
    await this.tokens.revoke(body.refreshToken);
    return ok({ loggedOut: true });
  }
}

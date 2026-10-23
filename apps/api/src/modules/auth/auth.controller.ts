import {
  RefreshBody,
  RequestOtpBody,
  VerifyOtpBody,
  type VerifyOtpResponse,
} from '@clickco/contracts';
import { Body, Controller, ForbiddenException, HttpCode, Inject, Ip, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Controller('auth')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AuthController {
  constructor(
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(
    @Body(new ZodValidationPipe(RequestOtpBody)) body: RequestOtpBody,
    @Ip() ip: string,
  ) {
    return ok(await this.otp.request(body.phone, body.purpose, ip || null));
  }

  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body(new ZodValidationPipe(VerifyOtpBody)) body: VerifyOtpBody) {
    await this.otp.verify(body.challengeId, body.phone, 'LOGIN', body.code);
    const { user, isNew } = await this.users.findOrCreateByPhone(body.phone);
    if (user.isBlocked) {
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'This account is blocked' });
    }
    const pair = await this.tokens.issue({ kind: 'USER', id: user.id }, body.deviceId ?? null);
    const response: VerifyOtpResponse = {
      ...pair,
      user: { id: user.id, phone: user.phone, fullName: user.fullName, isNew },
    };
    return ok(response);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(RefreshBody)) body: RefreshBody) {
    // USER only: a photographer session refreshes at /pro/auth/refresh and is not consumed here.
    const { subject, ...pair } = await this.tokens.refresh(body.refreshToken, 'USER');
    const user = await this.users.findById(subject.id);
    if (!user || user.isBlocked) {
      // A blocked account loses every session, not just this one.
      await this.tokens.revokeAll(subject);
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'This account is blocked' });
    }
    return ok(pair);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Body(new ZodValidationPipe(RefreshBody)) body: RefreshBody) {
    await this.tokens.revoke(body.refreshToken);
    return ok({ loggedOut: true });
  }
}

import { ConfirmAccountDeletionBody } from '@clickco/contracts';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UserGuard } from '../../common/guards/user.guard';
import { clientIp } from '../../common/http/client-ip';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { AccountDeletionService } from './account-deletion.service';

/** A handful a minute per IP: the code itself has its own per-phone limits. */
const WRITES = { default: { limit: 10, ttl: 60_000 } };

/**
 * ADR-0030 — the client app's Profile → "Delete account" (Apple 5.1.1(v), DPDP s.12):
 * GET explains and says whether it can happen now; POST request sends a code to the account's
 * phone; POST confirm (idempotent) deletes.
 */
@Controller('me/deletion')
export class AccountDeletionController {
  constructor(@Inject(AccountDeletionService) private readonly deletion: AccountDeletionService) {}

  @Get()
  @UseGuards(UserGuard)
  async preview(@CurrentSubject() subject: Subject) {
    return ok(await this.deletion.preview(subject.id));
  }

  @Post('request')
  @HttpCode(200)
  @UseGuards(UserGuard)
  @Throttle(WRITES)
  async request(@CurrentSubject() subject: Subject, @Ip() ip: string) {
    return ok(await this.deletion.request(subject.id, clientIp(ip)));
  }

  /**
   * AuthGuard, not UserGuard: a retry after the account is gone (its first answer lost) must
   * still reach the idempotent replay with the same, still-unexpired access token. The service
   * re-checks the account itself.
   */
  @Post('confirm')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @Throttle(WRITES)
  @Idempotent()
  async confirm(
    @CurrentSubject() subject: Subject,
    @Body(new ZodValidationPipe(ConfirmAccountDeletionBody)) body: ConfirmAccountDeletionBody,
  ) {
    if (subject.kind !== 'USER') {
      throw new ForbiddenException({
        code: 'CLIENTS_ONLY',
        message: 'Only client accounts can use this',
      });
    }
    return ok(await this.deletion.confirm(subject.id, body));
  }
}

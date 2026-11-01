import { BlockPhotographerBody, Uuid } from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CLOCK, type Clock } from '../../common/clock';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { BlocksService } from './blocks.service';
import { SAFETY_CONFIG } from './safety-rules';
import { toBlocked } from './views';

const BLOCK_WRITES = { default: { limit: SAFETY_CONFIG.blockWritesPerMinutePerIp, ttl: 60_000 } };

/**
 * The client's blocked photographers (ADR-0027 D4): never offered this client's bookings again.
 * Only someone who worked on one of the client's bookings can be blocked. Both writes are
 * idempotent.
 */
@Controller('me/blocks')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class ClientBlocksController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BlocksService) private readonly blocks: BlocksService,
  ) {}

  @Get()
  async list(@CurrentSubject() s: Subject) {
    return ok((await this.blocks.list(s.id)).map(toBlocked));
  }

  @Post()
  @HttpCode(200)
  @Throttle(BLOCK_WRITES)
  async block(
    @CurrentSubject() s: Subject,
    @Body(new ZodValidationPipe(BlockPhotographerBody)) body: BlockPhotographerBody,
  ) {
    return ok(toBlocked(await this.blocks.block(s.id, body.photographerId, this.clock())));
  }

  @Post(':photographerId/unblock')
  @HttpCode(200)
  @Throttle(BLOCK_WRITES)
  async unblock(
    @CurrentSubject() s: Subject,
    @Param('photographerId', new ZodValidationPipe(Uuid)) photographerId: string,
  ) {
    await this.blocks.unblock(s.id, photographerId, this.clock());
    return ok({ photographerId, blocked: false as const });
  }
}

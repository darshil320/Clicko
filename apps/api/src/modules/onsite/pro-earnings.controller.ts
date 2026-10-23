import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { ProGuard } from '../../common/guards/pro.guard';
import type { Subject } from '../auth/token.service';
import { EarningsService } from './earnings.service';
import { photographerId } from './http-errors';

/** G-23 earnings dashboard (expected payouts until S8). */
@Controller('pro/earnings')
@UseGuards(ProGuard)
export class ProEarningsController {
  constructor(@Inject(EarningsService) private readonly earnings: EarningsService) {}

  @Get()
  async mine(@CurrentSubject() s: Subject) {
    return ok(await this.earnings.forPhotographer(photographerId(s)));
  }
}

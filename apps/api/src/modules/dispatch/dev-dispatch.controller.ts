import { Uuid } from '@clickco/contracts';
import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import { DispatchDeskService } from './dispatch-desk.service';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found' };

/**
 * Development only: the ops console's dispatch desk reads rounds and offers here until the staff
 * console has authentication (S9). Answers 404 unless NODE_ENV=development.
 */
@Controller('dev/dispatch')
export class DevDispatchController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DispatchDeskService) private readonly desk: DispatchDeskService,
  ) {}

  @Get('bookings/:id')
  async booking(@Param('id', new ZodValidationPipe(Uuid)) id: string) {
    if (this.env.NODE_ENV !== 'development') throw new NotFoundException(NOT_FOUND);
    return ok(await this.desk.view(id));
  }
}

import { ConfirmIncidentBody, Uuid } from '@clickco/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import type { Actor } from '../bookings/bookings.types';
import { IncidentsService } from './incidents.service';
import { OnsiteViewsService } from './onsite-views.service';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found' };
/** The dev console has no staff identity: a stand-in STAFF actor (the admin desk passes the real one). */
const DEV_STAFF_ACTOR: Actor = { kind: 'STAFF', id: null };

/**
 * Development only (DevToolsModule): the ops console's assignment view and the incident
 * confirmation that the staff panel takes over in S9 (ADR-0013 D10/D17). 404 elsewhere.
 */
@Controller('dev/assignments')
export class DevOnsiteController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(OnsiteViewsService) private readonly views: OnsiteViewsService,
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
  ) {}

  @Get(':id')
  async assignment(@Param('id', new ZodValidationPipe(Uuid)) id: string) {
    this.devOnly();
    return ok(await this.views.devView(id));
  }

  @Post(':id/confirm-incident')
  @HttpCode(200)
  async confirmIncident(
    @Param('id', new ZodValidationPipe(Uuid)) id: string,
    @Body(new ZodValidationPipe(ConfirmIncidentBody)) body: ConfirmIncidentBody,
  ) {
    this.devOnly();
    return ok(await this.incidents.confirm(id, body.kind, DEV_STAFF_ACTOR));
  }

  private devOnly(): void {
    if (this.env.NODE_ENV !== 'development') throw new NotFoundException(NOT_FOUND);
  }
}

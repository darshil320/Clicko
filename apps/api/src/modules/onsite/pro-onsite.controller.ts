import {
  CheckInBody,
  CheckOutBody,
  ClientAbsentBody,
  IncidentBody,
  LogWaitingBody,
  RequestExtensionBody,
  Uuid,
} from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import type { z } from 'zod';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { ProGuard } from '../../common/guards/pro.guard';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { PRO_IDEMPOTENCY_TTL_MS } from '../dispatch/dispatch.config';
import { CheckInService } from './check-in.service';
import { CheckOutService } from './check-out.service';
import { ExtensionsService } from './extensions.service';
import { photographerId } from './http-errors';
import { IncidentsService } from './incidents.service';
import { OnsiteViewsService } from './onsite-views.service';
import { WaitingService } from './waiting.service';

const AssignmentId = new ZodValidationPipe(Uuid);
const PRO_KEYS = { ttlMs: PRO_IDEMPOTENCY_TTL_MS };

/**
 * On-site actions on the photographer's own assignment (ADR-0013). Someone else's is 404. Every
 * POST is @Idempotent; offline replays are also recognised by deviceTs (D4).
 */
@Controller('pro/assignments')
@UseGuards(ProGuard)
export class ProOnsiteController {
  constructor(
    @Inject(CheckInService) private readonly checkIns: CheckInService,
    @Inject(CheckOutService) private readonly checkOuts: CheckOutService,
    @Inject(ExtensionsService) private readonly extensions: ExtensionsService,
    @Inject(WaitingService) private readonly waiting: WaitingService,
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
    @Inject(OnsiteViewsService) private readonly views: OnsiteViewsService,
  ) {}

  @Get(':assignmentId')
  async detail(@CurrentSubject() s: Subject, @Param('assignmentId', AssignmentId) id: string) {
    return ok(await this.views.proDetail(photographerId(s), id));
  }

  @Post(':assignmentId/en-route')
  @HttpCode(200)
  @Idempotent(PRO_KEYS)
  async enRoute(@CurrentSubject() s: Subject, @Param('assignmentId', AssignmentId) id: string) {
    return ok(await this.checkIns.enRoute(photographerId(s), id));
  }

  @Post(':assignmentId/check-in')
  @HttpCode(200)
  @Idempotent(PRO_KEYS)
  async checkIn(
    @CurrentSubject() s: Subject,
    @Param('assignmentId', AssignmentId) id: string,
    @Body(new ZodValidationPipe(CheckInBody)) body: z.output<typeof CheckInBody>,
  ) {
    return ok(await this.checkIns.checkIn(photographerId(s), id, body));
  }

  @Post(':assignmentId/start')
  @HttpCode(200)
  @Idempotent(PRO_KEYS)
  async start(@CurrentSubject() s: Subject, @Param('assignmentId', AssignmentId) id: string) {
    return ok(await this.checkIns.start(photographerId(s), id));
  }

  @Post(':assignmentId/check-out')
  @HttpCode(200)
  @Idempotent(PRO_KEYS)
  async checkOut(
    @CurrentSubject() s: Subject,
    @Param('assignmentId', AssignmentId) id: string,
    @Body(new ZodValidationPipe(CheckOutBody)) body: z.output<typeof CheckOutBody>,
  ) {
    return ok(await this.checkOuts.checkOut(photographerId(s), id, body));
  }

  @Post(':assignmentId/extensions')
  @HttpCode(201)
  @Idempotent(PRO_KEYS)
  async requestExtension(
    @CurrentSubject() s: Subject,
    @Param('assignmentId', AssignmentId) id: string,
    @Body(new ZodValidationPipe(RequestExtensionBody)) body: RequestExtensionBody,
  ) {
    return ok(await this.extensions.request(photographerId(s), id, body.deviceTs));
  }

  @Post(':assignmentId/waiting')
  @HttpCode(201)
  @Idempotent(PRO_KEYS)
  async logWaiting(
    @CurrentSubject() s: Subject,
    @Param('assignmentId', AssignmentId) id: string,
    @Body(new ZodValidationPipe(LogWaitingBody)) body: LogWaitingBody,
  ) {
    return ok(await this.waiting.log(photographerId(s), id, body));
  }

  @Post(':assignmentId/access-denied')
  @HttpCode(201)
  @Idempotent(PRO_KEYS)
  async accessDenied(
    @CurrentSubject() s: Subject,
    @Param('assignmentId', AssignmentId) id: string,
    @Body(new ZodValidationPipe(IncidentBody)) body: IncidentBody,
  ) {
    return ok(await this.incidents.report(photographerId(s), id, 'ACCESS_DENIED', body));
  }

  @Post(':assignmentId/unsafe')
  @HttpCode(201)
  @Idempotent(PRO_KEYS)
  async unsafe(
    @CurrentSubject() s: Subject,
    @Param('assignmentId', AssignmentId) id: string,
    @Body(new ZodValidationPipe(IncidentBody)) body: IncidentBody,
  ) {
    return ok(await this.incidents.report(photographerId(s), id, 'UNSAFE_SITE', body));
  }

  @Post(':assignmentId/client-absent')
  @HttpCode(200)
  @Idempotent(PRO_KEYS)
  async clientAbsent(
    @CurrentSubject() s: Subject,
    @Param('assignmentId', AssignmentId) id: string,
    @Body(new ZodValidationPipe(ClientAbsentBody)) body: z.output<typeof ClientAbsentBody>,
  ) {
    return ok(await this.checkOuts.clientAbsent(photographerId(s), id, body));
  }
}

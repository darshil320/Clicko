import { createHash } from 'node:crypto';
import {
  ClientQualityIssue,
  ClientQualityIssueBody,
  ClientTicket,
  ClientTicketBody,
  ClientTicketList,
  ClientTicketReply,
  ClientTicketReplyBody,
  ClientTicketThread,
  Uuid,
} from '@clickco/contracts';
import {
  Body,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CLOCK, type Clock } from '../../common/clock';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { UsersService } from '../users/users.service';
import { CLIENT_CARE_CONFIG } from './care-rules';
import {
  toClientQualityIssue,
  toClientTicket,
  toClientTicketReply,
  toClientTicketThread,
} from './client-views';
import { QualityService } from './quality.service';
import { TicketsService } from './tickets.service';

/**
 * One budget per IP bucket shared by the three client care writes (the throttler's own key is per
 * route, which would give 10 a minute to each). Hashed like the throttler's default key.
 */
const sharedCareWritesKey = (_context: ExecutionContext, tracker: string, name: string): string =>
  createHash('sha256').update(`client-care-writes:${name}:${tracker}`).digest('hex');

const WRITES = {
  default: {
    limit: CLIENT_CARE_CONFIG.writesPerMinutePerIp,
    ttl: 60_000,
    generateKey: sharedCareWritesKey,
  },
};

/**
 * The client's own way into customer care (ADR-0027 D5, SA-02): raise a support ticket, see their
 * tickets with the 48 h / 30 d clocks and the conversation (never staff notes), answer support on
 * an open ticket, report a quality issue on a delivered booking. Writes are @Idempotent (a retried
 * tap never raises a second ticket, reply or issue) and limited per IP and, for tickets and
 * replies, per client per day.
 */
@Controller()
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class ClientCareController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(QualityService) private readonly quality: QualityService,
  ) {}

  @Post('me/tickets')
  @HttpCode(201)
  @Throttle(WRITES)
  @Idempotent()
  async raise(
    @CurrentSubject() s: Subject,
    @Body(new ZodValidationPipe(ClientTicketBody)) body: ClientTicketBody,
  ) {
    const user = await this.users.findById(s.id);
    // A deleted account has no phone (ADR-0030); UserGuard has already refused it.
    if (!user?.phone) {
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'Not allowed' });
    }
    const ticket = await this.tickets.raiseForClient(
      {
        userId: user.id,
        contactName: user.fullName ?? 'Clickco client',
        contactPhone: user.phone,
        bookingId: body.bookingId ?? null,
        category: body.category,
        message: body.message,
      },
      this.clock(),
    );
    return ok(ClientTicket.parse(toClientTicket(ticket)));
  }

  @Get('me/tickets')
  async mine(@CurrentSubject() s: Subject) {
    const tickets = await this.tickets.listForClient(s.id);
    return ok(ClientTicketList.parse(tickets.map(toClientTicket)));
  }

  @Get('me/tickets/:id')
  async one(@CurrentSubject() s: Subject, @Param('id', new ZodValidationPipe(Uuid)) id: string) {
    const thread = await this.tickets.threadForClient(s.id, id);
    return ok(ClientTicketThread.parse(toClientTicketThread(thread.ticket, thread.messages)));
  }

  /** 409 TICKET_CLOSED once resolved; 404 for a ticket that is not the caller's. */
  @Post('me/tickets/:id/messages')
  @HttpCode(201)
  @Throttle(WRITES)
  @Idempotent()
  async reply(
    @CurrentSubject() s: Subject,
    @Param('id', new ZodValidationPipe(Uuid)) id: string,
    @Body(new ZodValidationPipe(ClientTicketReplyBody)) body: ClientTicketReplyBody,
  ) {
    const reply = await this.tickets.replyForClient(
      { userId: s.id, ticketId: id, message: body.message },
      this.clock(),
    );
    // Only the new message and the status: the idempotency store never keeps support's replies.
    return ok(ClientTicketReply.parse(toClientTicketReply(reply)));
  }

  @Post('bookings/:id/quality-issue')
  @HttpCode(201)
  @Throttle(WRITES)
  @Idempotent()
  async reportQuality(
    @CurrentSubject() s: Subject,
    @Param('id', new ZodValidationPipe(Uuid)) id: string,
    @Body(new ZodValidationPipe(ClientQualityIssueBody)) body: ClientQualityIssueBody,
  ) {
    const issue = await this.quality.openForClient({
      userId: s.id,
      bookingId: id,
      complaint: body.complaint,
      now: this.clock(),
    });
    return ok(ClientQualityIssue.parse(toClientQualityIssue(issue)));
  }
}

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { CallsService } from './calls.service';

const NAME = 'calls.binding';

/** Cancellations close every binding of the booking at once (ADR-0027 D3). */
const CANCELLATIONS = ['booking.cancelled_client', 'booking.cancelled_pro', 'booking.pro_no_show'];
/** The shoot ended without a check-out: the window closes 2 h later, as after a check-out. */
const ENDED_WITHOUT_CHECK_OUT = ['booking.access_denied', 'booking.unsafe_site'];

/** The masked-call window follows the assignment (ADR-0027 D3). */
@Injectable()
export class CallsSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(CallsService) private readonly calls: CallsService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.assigned', NAME, (e) => this.calls.open(e));
    this.subscribers.subscribe('booking.checked_out', NAME, (e) => this.calls.checkedOut(e));
    this.subscribers.subscribe('booking.redispatching', NAME, (e) => this.calls.released(e));
    for (const type of ENDED_WITHOUT_CHECK_OUT) {
      this.subscribers.subscribe(type, NAME, (e) => this.calls.shootEnded(e));
    }
    for (const type of CANCELLATIONS) {
      this.subscribers.subscribe(type, NAME, (e) => this.calls.cancelled(e));
    }
  }
}

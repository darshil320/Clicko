import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { MAPPED_EVENT_TYPES } from './pipeline/event-map';
import { NotificationEnqueuer } from './pipeline/notification-enqueuer';

/** Every mapped lifecycle event fans out to one queued message per recipient (ADR-0027 D2). */
@Injectable()
export class NotificationsSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(NotificationEnqueuer) private readonly enqueuer: NotificationEnqueuer,
  ) {}

  onModuleInit(): void {
    for (const type of MAPPED_EVENT_TYPES) {
      this.subscribers.subscribe(type, 'notifications.enqueue', async (e) => {
        await this.enqueuer.enqueue(e);
      });
    }
  }
}

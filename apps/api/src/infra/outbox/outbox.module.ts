import { Global, Module } from '@nestjs/common';
import { OutboxPublisher } from './outbox-publisher';
import { OutboxSubscribers } from './outbox-subscribers';

/** Global: any module subscribes to domain events; the publisher job drains the outbox. */
@Global()
@Module({
  providers: [OutboxSubscribers, OutboxPublisher],
  exports: [OutboxSubscribers, OutboxPublisher],
})
export class OutboxModule {}

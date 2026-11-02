import { Injectable } from '@nestjs/common';

/** A domain_events row as delivered to a subscriber (DOMAIN §3 envelope). */
export interface PublishedEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

/**
 * Delivery is at-least-once: a handler can see the same event again (a crash before
 * published_at commits, another subscriber of the same event failing, or a delivery that ran
 * past its time limit). Handlers MUST be idempotent — check state, don't assume first delivery.
 *
 * `signal` aborts when the delivery runs past OutboxPublisher's time limit (DELIVERY_TIMEOUT_MS):
 * the event is then retried on backoff, so a long handler should pass the signal to its I/O (or
 * check it between steps) and stop. It is absent when a handler is called outside the publisher.
 */
export type EventHandler = (event: PublishedEvent, signal?: AbortSignal) => Promise<void>;

interface Subscription {
  readonly name: string;
  readonly handle: EventHandler;
}

/** In-process subscribers by event type. Modules register in onModuleInit. */
@Injectable()
export class OutboxSubscribers {
  private readonly byType = new Map<string, readonly Subscription[]>();

  subscribe(eventType: string, name: string, handle: EventHandler): void {
    const current = this.byType.get(eventType) ?? [];
    if (current.some((s) => s.name === name)) {
      throw new Error(`Subscriber ${name} is already registered for ${eventType}`);
    }
    this.byType.set(eventType, [...current, { name, handle }]);
  }

  subscribersOf(eventType: string): readonly Subscription[] {
    return this.byType.get(eventType) ?? [];
  }
}

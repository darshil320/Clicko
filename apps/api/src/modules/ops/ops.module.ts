import { Module } from '@nestjs/common';
import { OpsAlertsReader } from './ops-alerts.reader';
import { OpsAlertsSubscriber } from './ops-alerts.subscriber';

/**
 * Ops alerting. Owns no tables: it writes `ops.alert` events to the outbox, and reads them (with
 * the `*.needs_review` events) back for the staff alert feed (ADR-0025).
 */
@Module({ providers: [OpsAlertsSubscriber, OpsAlertsReader], exports: [OpsAlertsReader] })
export class OpsModule {}

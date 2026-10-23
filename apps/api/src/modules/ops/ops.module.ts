import { Module } from '@nestjs/common';
import { OpsAlertsSubscriber } from './ops-alerts.subscriber';

/** Ops alerting. Owns no tables: it writes `ops.alert` events to the outbox. */
@Module({ providers: [OpsAlertsSubscriber] })
export class OpsModule {}

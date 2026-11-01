import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { CheckoutModule } from '../modules/checkout/checkout.module';
import { DispatchModule } from '../modules/dispatch/dispatch.module';
import { MediaModule } from '../modules/media/media.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { OnsiteModule } from '../modules/onsite/onsite.module';
import { SlaModule } from '../modules/sla/sla.module';
import { CheckoutSweepProcessor } from './checkout-sweep.processor';
import { DispatchTimersProcessor } from './dispatch-timers.processor';
import { IntegrityAuditProcessor } from './integrity-audit.processor';
import { JpegExportProcessor } from './jpeg-export.processor';
import { NotificationSendProcessor } from './notification-send.processor';
import { OnsiteTimersProcessor } from './onsite-timers.processor';
import { OtpSmsProcessor } from './otp-sms.processor';
import { OutboxPublishProcessor } from './outbox-publish.processor';
import { QuotaMonitorProcessor } from './quota-monitor.processor';
import { SlaProcessor } from './sla.processor';
import { UploadReaperProcessor } from './upload-reaper.processor';

/** Every BullMQ processor. They register with infra/queues' JobRegistry at module init. */
@Module({
  imports: [
    DispatchModule,
    AuthModule,
    MediaModule,
    OnsiteModule,
    SlaModule,
    CheckoutModule,
    NotificationsModule,
  ],
  providers: [
    OutboxPublishProcessor,
    DispatchTimersProcessor,
    OnsiteTimersProcessor,
    OtpSmsProcessor,
    JpegExportProcessor,
    IntegrityAuditProcessor,
    QuotaMonitorProcessor,
    UploadReaperProcessor,
    SlaProcessor,
    CheckoutSweepProcessor,
    NotificationSendProcessor,
  ],
})
export class JobsModule {}

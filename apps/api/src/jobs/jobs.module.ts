import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { DispatchModule } from '../modules/dispatch/dispatch.module';
import { DispatchTimersProcessor } from './dispatch-timers.processor';
import { OtpSmsProcessor } from './otp-sms.processor';
import { OutboxPublishProcessor } from './outbox-publish.processor';

/** Every BullMQ processor. They register with infra/queues' JobRegistry at module init. */
@Module({
  imports: [DispatchModule, AuthModule],
  providers: [OutboxPublishProcessor, DispatchTimersProcessor, OtpSmsProcessor],
})
export class JobsModule {}

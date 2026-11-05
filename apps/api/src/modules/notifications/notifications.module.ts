import { Module } from '@nestjs/common';
import { ProGuard } from '../../common/guards/pro.guard';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CallsModule } from '../calls/calls.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PhotographersModule } from '../photographers/photographers.module';
import { UsersModule } from '../users/users.module';
import { NotificationAccountErasure } from './account-erasure';
import { CHANNEL_PROVIDERS } from './channels/channel-providers';
import {
  ClientNotificationSettingsController,
  ProNotificationSettingsController,
} from './notification-settings.controllers';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationsSubscribers } from './notifications.subscribers';
import { NotificationEnqueuer } from './pipeline/notification-enqueuer';
import { NotificationSender } from './pipeline/notification-sender';
import { NotificationReaders } from './pipeline/readers';
import { NotificationSendsRepository } from './repositories/notification-sends.repository';
import { PreferencesRepository } from './repositories/preferences.repository';
import { PushTokensRepository } from './repositories/push-tokens.repository';

/**
 * Lifecycle notifications (ADR-0027 D1/D2). Owns notification_sends, device_push_tokens and
 * notification_preferences. Domain events → event-map → one BullMQ job per recipient
 * (jobs/notification-send.processor.ts) → WhatsApp / SMS / push behind ports. Reads bookings,
 * users, photographers, assignments (dispatch), delivery links and the call number (calls)
 * through their services. API process only: never imported by the media worker.
 */
@Module({
  imports: [
    TokenModule,
    BookingsModule,
    UsersModule,
    PhotographersModule,
    DispatchModule,
    DeliveryModule,
    CallsModule,
  ],
  controllers: [ClientNotificationSettingsController, ProNotificationSettingsController],
  providers: [
    ProGuard,
    ...CHANNEL_PROVIDERS,
    NotificationSendsRepository,
    PushTokensRepository,
    PreferencesRepository,
    NotificationReaders,
    NotificationEnqueuer,
    NotificationSender,
    NotificationSettingsService,
    NotificationsSubscribers,
    NotificationAccountErasure,
  ],
  exports: [NotificationSender, NotificationAccountErasure],
})
export class NotificationsModule {}

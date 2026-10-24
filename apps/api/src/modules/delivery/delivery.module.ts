import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { MediaModule } from '../media/media.module';
import { ClientDeliveryController } from './client-delivery.controller';
import { DeliverySubscribers } from './delivery.subscribers';
import { PublicDeliveryController } from './public-delivery.controller';
import { QaService } from './qa.service';
import { ReleaseService } from './release.service';
import { DeliveriesRepository } from './repositories/deliveries.repository';
import { DeliveryLinksRepository } from './repositories/delivery-links.repository';
import { RetentionService } from './retention.service';

/**
 * Owns deliveries and delivery_links (ADR-0016): the QA gate, the release of links once the
 * balance clears, the public link route, and what retention clocks do when due. Files are
 * media's (MediaRetentionService); bytes and links go through StoragePort.
 */
@Module({
  imports: [TokenModule, BookingsModule, MediaModule, StorageModule],
  controllers: [ClientDeliveryController, PublicDeliveryController],
  providers: [
    DeliveriesRepository,
    DeliveryLinksRepository,
    QaService,
    ReleaseService,
    RetentionService,
    DeliverySubscribers,
  ],
  exports: [QaService, ReleaseService],
})
export class DeliveryModule {}

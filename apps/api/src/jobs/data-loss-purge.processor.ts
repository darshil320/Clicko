import { Uuid } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { type JobData, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { DataLossPurgeService } from '../modules/media/data-loss-purge.service';

const Data = z.object({ bookingId: Uuid });

/**
 * Once per lost booking (`booking.data_loss`, ADR-0030): deletes every file it stored through
 * StoragePort. Throws ⇒ BullMQ retries (JOB_OPTIONS); a re-run finds nothing more to delete.
 */
@Injectable()
export class DataLossPurgeProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(DataLossPurgeService) private readonly purges: DataLossPurgeService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.MEDIA_DATA_LOSS_PURGE, {
      process: async (data: JobData) => {
        await this.purges.purge(Data.parse(data).bookingId);
      },
    });
  }
}

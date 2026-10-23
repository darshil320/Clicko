import { Uuid } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { type JobData, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { JpegExportService } from '../modules/media/jpeg-export.service';

const Data = z.object({ bookingId: Uuid });

/** RAW → JPEG for one PROCESSING booking, then → QA (ADR-0014 D4). Throws ⇒ BullMQ retries. */
@Injectable()
export class JpegExportProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(JpegExportService) private readonly exporter: JpegExportService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.MEDIA_JPEG_EXPORT, {
      process: async (data: JobData) => {
        const outcome = await this.exporter.exportBooking(Data.parse(data).bookingId);
        // Each failed RAW has its own ops alert; the retry only re-attempts those (M6).
        if (outcome.kind === 'INCOMPLETE') {
          throw new Error(`${outcome.failed} RAW file(s) failed to export; will retry`);
        }
      },
    });
  }
}

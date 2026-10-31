import { Uuid } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { type JobData, JobRegistry } from '../infra/queues/job-registry';
import { PROCESS_ROLE, type ProcessRole } from '../infra/queues/process-role';
import { JOB } from '../infra/queues/queue-names';
import { JpegExportService } from '../modules/media/jpeg-export.service';

const Data = z.object({ bookingId: Uuid });

/**
 * RAW → JPEG for one PROCESSING booking, then → QA (ADR-0014 D4). Throws ⇒ BullMQ retries.
 * Audit H1: with MEDIA_WORKER_ISOLATED only the media worker (worker.ts) registers it; the API
 * process never runs darktable.
 */
@Injectable()
export class JpegExportProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(JpegExportService) private readonly exporter: JpegExportService,
    @Inject(ENV) private readonly env: Env,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'api',
  ) {}

  onModuleInit(): void {
    if (this.role === 'api' && this.env.MEDIA_WORKER_ISOLATED) return;
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

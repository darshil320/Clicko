import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { UploadReaperService } from '../modules/media/upload-reaper.service';

/** Hourly (REPEATABLE_JOBS): reclaims staged parts of idle upload sessions (security review M5). */
@Injectable()
export class UploadReaperProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(UploadReaperService) private readonly reaper: UploadReaperService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.MEDIA_UPLOAD_REAPER, {
      process: async () => {
        await this.reaper.sweep();
      },
    });
  }
}

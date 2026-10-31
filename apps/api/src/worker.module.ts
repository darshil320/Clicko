import { Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from './common/clock';
import { ENV, loadWorkerEnv } from './config/env';
import { DbModule } from './infra/db/db.module';
import { OutboxModule } from './infra/outbox/outbox.module';
import { PROCESS_ROLE, type ProcessRole } from './infra/queues/process-role';
import { QueuesModule } from './infra/queues/queues.module';
import { JpegExportProcessor } from './jobs/jpeg-export.processor';
import { MediaExportModule } from './modules/media/media-export.module';

const ROLE: ProcessRole = 'media-worker';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadWorkerEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
    { provide: PROCESS_ROLE, useValue: ROLE },
  ],
  exports: [ENV, CLOCK, PROCESS_ROLE],
})
class WorkerCoreModule {}

/**
 * The media worker (audit H1, ADR-0027 D6): consumes ONLY the media-export queue and registers
 * ONLY the JPEG export processor. No HTTP server, no payments, dispatch, auth or admin modules.
 * It runs in its own hardened container (apps/api/CLAUDE.md "Media worker"); darktable runs as a
 * child with a stripped environment, a size guard and a memory cap.
 */
@Module({
  imports: [WorkerCoreModule, DbModule, QueuesModule, OutboxModule, MediaExportModule],
  providers: [JpegExportProcessor],
})
export class WorkerModule {}

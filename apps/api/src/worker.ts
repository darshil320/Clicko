import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadWorkerEnv } from './config/env';
import { WorkerModule } from './worker.module';

/**
 * Entry point of the separate media worker (audit H1): `node dist/worker.js`. It only makes sense
 * with MEDIA_WORKER_ISOLATED=true — the API then leaves the media-export queue to this process.
 */
async function bootstrap(): Promise<void> {
  // Throws unless MEDIA_WORKER_ISOLATED=true, and (deployed) if any app secret is present.
  loadWorkerEnv(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('MediaWorker').log('Consuming the media-export queue');
}

void bootstrap().catch((error: unknown) => {
  new Logger('MediaWorker').error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

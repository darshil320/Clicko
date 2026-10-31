import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env';
import { JobRegistry } from '../../infra/queues/job-registry';
import { queuesFor, repeatablesFor } from '../../infra/queues/process-role';
import { JOB, QUEUE } from '../../infra/queues/queue-names';
import { AdminModule } from '../../modules/admin/admin.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { TokenModule } from '../../modules/auth/token.module';
import { CheckoutModule } from '../../modules/checkout/checkout.module';
import { DispatchModule } from '../../modules/dispatch/dispatch.module';
import type { JpegExportService } from '../../modules/media/jpeg-export.service';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { WorkerModule } from '../../worker.module';
import { JpegExportProcessor } from '../jpeg-export.processor';

/** Every module reachable from `root` through `imports` (static metadata, no DI container). */
function reachable(root: object, seen = new Set<object>()): Set<object> {
  if (seen.has(root)) return seen;
  seen.add(root);
  const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, root) ?? []) as object[];
  for (const m of imports) if (m) reachable(m, seen);
  return seen;
}

const exporter = {} as JpegExportService;
const envWith = (isolated: boolean) => ({ MEDIA_WORKER_ISOLATED: isolated }) as Env;

describe('audit H1 — darktable runs in its own worker process', () => {
  it('an isolated API never consumes the media-export queue; the worker consumes only it', () => {
    expect(queuesFor('api', true)).not.toContain(QUEUE.MEDIA_EXPORT);
    expect(queuesFor('api', true)).toContain(QUEUE.OUTBOX);
    expect(queuesFor('api', false)).toContain(QUEUE.MEDIA_EXPORT);
    expect(queuesFor('media-worker', true)).toEqual([QUEUE.MEDIA_EXPORT]);
    expect(repeatablesFor('media-worker', true)).toEqual([]);
    expect(repeatablesFor('api', true).map((r) => r.job)).toContain(JOB.OUTBOX_PUBLISH);
  });

  it('the API process registers no export processor when the worker is separate', () => {
    const registry = new JobRegistry();
    new JpegExportProcessor(registry, exporter, envWith(true), 'api').onModuleInit();
    expect(registry.processorFor(JOB.MEDIA_JPEG_EXPORT)).toBeUndefined();

    const inProcess = new JobRegistry();
    new JpegExportProcessor(inProcess, exporter, envWith(false), 'api').onModuleInit();
    expect(inProcess.processorFor(JOB.MEDIA_JPEG_EXPORT)).toBeDefined();

    const worker = new JobRegistry();
    new JpegExportProcessor(worker, exporter, envWith(true), 'media-worker').onModuleInit();
    expect(worker.processorFor(JOB.MEDIA_JPEG_EXPORT)).toBeDefined();
  });

  it('the worker never loads payments, checkout, auth, admin or token signing', () => {
    const modules = reachable(WorkerModule);
    for (const forbidden of [
      PaymentsModule,
      CheckoutModule,
      AuthModule,
      TokenModule,
      AdminModule,
      DispatchModule,
    ]) {
      expect(modules.has(forbidden)).toBe(false);
    }
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkerModule) ??
      []) as unknown[];
    expect(providers).toEqual([JpegExportProcessor]);
  });
});

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { IntegrityAuditService } from '../modules/media/integrity-audit.service';

/** Weekly (REPEATABLE_JOBS): declared vs stored vs provider counts per booking (ADR-0014 D5). */
@Injectable()
export class IntegrityAuditProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(IntegrityAuditService) private readonly audit: IntegrityAuditService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.MEDIA_INTEGRITY_AUDIT, {
      process: async () => {
        await this.audit.auditAll();
      },
    });
  }
}

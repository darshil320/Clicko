import { BookingStatus, MEDIA_LIMITS, PlanTier, type ProUploadJob } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { UPLOAD_JOB_STATUSES } from './media.config';
import type { UploadSessionRecord } from './media.types';
import { MediaAssetsRepository } from './repositories/media-assets.repository';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { UploadBookings } from './upload-bookings';

const HOUR_MS = 3_600_000;

const summary = (s: UploadSessionRecord) => ({
  sessionId: s.id,
  status: s.status,
  declaredFileCount: s.declaredFileCount,
  receivedFileCount: s.receivedFileCount,
  declaredBytes: s.declaredBytes,
  receivedBytes: s.receivedBytes,
  startedAt: s.startedAt.toISOString(),
  lastActivityAt: s.lastActivityAt.toISOString(),
});

/** GET /pro/upload-jobs — the portal's Jobs and Status pages (ADR-0014 D2). */
@Injectable()
export class UploadJobsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(UploadBookings) private readonly bookings: UploadBookings,
    @Inject(UploadSessionsRepository) private readonly sessions: UploadSessionsRepository,
    @Inject(MediaAssetsRepository) private readonly assets: MediaAssetsRepository,
  ) {}

  async list(photographerId: string): Promise<ProUploadJob[]> {
    const engagements = await this.assignments.recentEngagements(photographerId, this.clock());
    const facts = await this.bookings.many(engagements.map((e) => e.bookingId));
    const jobs = engagements.filter((e) => {
      const status = facts.get(e.bookingId)?.status;
      return status !== undefined && (UPLOAD_JOB_STATUSES as readonly string[]).includes(status);
    });
    const ids = jobs.map((e) => e.bookingId);
    const active = new Map(
      (await this.sessions.activeForBookings(this.sql, ids)).map((s) => [s.bookingId, s]),
    );
    const counts = await this.assets.countsForBookings(this.sql, ids);

    const views = await Promise.all(
      jobs.map(async (e): Promise<ProUploadJob> => {
        const b = facts.get(e.bookingId);
        if (!b) throw new Error(`upload-jobs: booking ${e.bookingId} vanished`);
        const checkedOutAt = await this.bookings.checkedOutAt(e.bookingId);
        const session = active.get(e.bookingId);
        return {
          bookingId: e.bookingId,
          assignmentId: e.assignmentId,
          bookingReference: b.reference,
          bookingStatus: BookingStatus.parse(b.status),
          categoryCode: b.categoryCode,
          tier: PlanTier.parse(b.tier),
          scheduledStart: b.scheduledStart.toISOString(),
          checkedOutAt: checkedOutAt?.toISOString() ?? null,
          uploadDeadlineAt: checkedOutAt
            ? new Date(
                checkedOutAt.getTime() + MEDIA_LIMITS.uploadDeadlineHours * HOUR_MS,
              ).toISOString()
            : null,
          activeSession: session ? summary(session) : null,
          media: counts.get(e.bookingId) ?? {
            rawFiles: 0,
            jpegFiles: 0,
            videoFiles: 0,
            exportedJpegs: 0,
            uploadedBytes: 0,
          },
        };
      }),
    );
    // Most urgent first: awaiting upload by deadline, then processing/QA.
    return [...views].sort((a, b) => {
      const ad = a.uploadDeadlineAt ?? '9999';
      const bd = b.uploadDeadlineAt ?? '9999';
      return ad === bd ? b.scheduledStart.localeCompare(a.scheduledStart) : ad.localeCompare(bd);
    });
  }
}

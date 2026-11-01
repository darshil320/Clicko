import type { ReportTargetKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';

/**
 * Open reports as other modules may see them (ADR-0027 D4): the reviews module refuses an edit
 * while a report on the review is open, without naming `moderation_reports` itself.
 */
@Injectable()
export class ReportsReader {
  async hasOpenReport(
    db: postgres.ISql,
    targetKind: ReportTargetKind,
    targetId: string,
  ): Promise<boolean> {
    const [row] = await db<{ open: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM moderation_reports
        WHERE target_kind = ${targetKind} AND target_id = ${targetId} AND status = 'OPEN'
      ) AS open`;
    return row?.open ?? false;
  }
}

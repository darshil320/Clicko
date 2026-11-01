import type { BlockedPhotographer, ReportReceipt } from '@clickco/contracts';
import type { BlockedView } from './blocks.service';
import type { ReportRecord } from './safety.types';

export const toReceipt = (r: ReportRecord): ReportReceipt => ({
  id: r.id,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
});

export const toBlocked = (b: BlockedView): BlockedPhotographer => ({
  photographerId: b.photographerId,
  name: b.name,
  blockedAt: b.blockedAt.toISOString(),
});

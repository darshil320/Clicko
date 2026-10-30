import { AdminOverview } from '@clickco/contracts';
import type { AdminRequests } from './admin-http.js';

/**
 * ADR-0026 stream E — `/admin` overview routes ("Today", D8). The answer is role- and
 * city-scoped by the server; the panel polls it for the Today page and the nav's live counts.
 */
export function adminOverviewRoutes(r: AdminRequests) {
  return {
    /** The live numbers, the "Needs you" cards and the latest alerts for the caller. */
    get: () => r.get('/admin/overview', AdminOverview),
  };
}

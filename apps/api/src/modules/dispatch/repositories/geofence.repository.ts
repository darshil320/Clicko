import { Injectable } from '@nestjs/common';
import type { Db } from '../dispatch.types';

/**
 * The on-site geofence distance (G-15, ADR-0013 D3). PostGIS stays in dispatch/repositories
 * (apps/api/CLAUDE.md). Geography distance in metres on the WGS84 spheroid.
 */
@Injectable()
export class GeofenceRepository {
  /** `venue` is geography text (hex EWKB) from the bookings row or the serviceability fallback. */
  async distanceMetres(db: Db, venue: string, lat: number, lng: number): Promise<number> {
    const [row] = await db<{ metres: number }[]>`
      SELECT ST_Distance(${venue}::geography,
                         ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography)
             AS metres`;
    if (!row) throw new Error('distanceMetres: no row returned');
    return Number(row.metres);
  }
}

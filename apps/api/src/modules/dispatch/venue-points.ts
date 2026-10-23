import { Inject, Injectable } from '@nestjs/common';
import type { DispatchFacts } from '../bookings/bookings.types';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import type { VenuePoint } from './dispatch.types';

/**
 * ADR-0010 fallback chain: geocoded venue → pincode centroid → city centre (geocoding is S11).
 * Dispatch measures reach from it; the on-site geofence measures presence and records the basis.
 */
@Injectable()
export class VenuePoints {
  constructor(
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
  ) {}

  async resolve(
    facts: Pick<DispatchFacts, 'bookingId' | 'venueLocation' | 'venuePincode'>,
  ): Promise<VenuePoint> {
    if (facts.venueLocation) return { point: facts.venueLocation, basis: 'VENUE' };
    const fallback = await this.serviceability.venueFallback(facts.venuePincode);
    if (!fallback) throw new Error(`Booking ${facts.bookingId} has no venue point`);
    return fallback;
  }
}

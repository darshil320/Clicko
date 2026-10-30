import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import type { AdminBookingFacts } from '../../bookings/bookings.types';
import type { BookingScope, TicketScope } from '../../care/care.types';
import { AssignmentReads } from '../../dispatch/assignment-reads.service';
import { PhotographerDirectoryService } from '../../photographers/directory.service';
import { PhotographersService } from '../../photographers/photographers.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import { type CityScope, scopeCovers } from '../access/roles';
import { StaffNames } from './staff-names';

const BOOKING_NOT_FOUND = { code: 'BOOKING_NOT_FOUND', message: 'No booking with that reference' };

export interface BookingContext {
  readonly facts: ReadonlyMap<string, AdminBookingFacts>;
  readonly cities: ReadonlyMap<string, string>;
  /** The photographer on each booking (latest assignment), by booking id. */
  readonly photographerOf: ReadonlyMap<string, { readonly id: string; readonly name: string }>;
}

/**
 * What the care desks show around their rows — booking reference, city, client, photographer,
 * staff names — asked of the modules that own each (ADR-0026 D6). Also builds the caller's city
 * scope as owner-built subqueries (ADR-0025 D3).
 */
@Injectable()
export class CareContext {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(PhotographerDirectoryService) private readonly directory: PhotographerDirectoryService,
    @Inject(StaffNames) readonly staff: StaffNames,
  ) {}

  /** Bookings in the caller's cities (null = every city). Build one per query. */
  bookingScope(scope: CityScope): BookingScope {
    return scope === 'ALL' ? null : this.bookings.idsInScope(scope);
  }

  /** A ticket is in scope through its booking or its photographer. Build one per query. */
  ticketScope(scope: CityScope): TicketScope {
    return scope === 'ALL'
      ? null
      : {
          bookings: this.bookings.idsInScope(scope),
          photographers: this.directory.idsInScope(scope),
        };
  }

  /** The booking a reference names, in the caller's cities (else 404 — never probe-able). */
  async bookingIdFor(reference: string, scope: CityScope): Promise<string> {
    const id = await this.bookings.idByReference(reference);
    const cityId = id ? await this.bookings.cityOf(id) : null;
    if (!id || cityId === null || !scopeCovers(scope, cityId)) {
      throw new NotFoundException(BOOKING_NOT_FOUND);
    }
    return id;
  }

  async bookingsContext(bookingIds: readonly string[]): Promise<BookingContext> {
    const ids = [...new Set(bookingIds)];
    const [facts, assignments] = await Promise.all([
      this.bookings.adminFacts(ids),
      this.assignments.latestForBookings(ids),
    ]);
    const [cities, names] = await Promise.all([
      this.serviceability.cityNames([...new Set(facts.map((f) => f.cityId))]),
      this.photographers.displayNames([...assignments.values()].map((a) => a.photographerId)),
    ]);
    const photographerOf = new Map(
      [...assignments.entries()].map(([bookingId, a]) => [
        bookingId,
        { id: a.photographerId, name: names.get(a.photographerId) ?? '' },
      ]),
    );
    return { facts: new Map(facts.map((f) => [f.id, f])), cities, photographerOf };
  }

  photographerNames(ids: readonly string[]): Promise<Map<string, string>> {
    return this.photographers.displayNames(ids);
  }

  /**
   * The photographer with this phone, only when they are in the caller's cities — otherwise
   * null, exactly as for an unknown number (no probing which numbers are photographers).
   */
  async photographerInScope(phone: string, scope: CityScope): Promise<string | null> {
    const id = await this.directory.idByPhone(phone);
    if (!id) return null;
    const cityId = await this.directory.cityOf(id);
    return cityId !== null && scopeCovers(scope, cityId) ? id : null;
  }
}

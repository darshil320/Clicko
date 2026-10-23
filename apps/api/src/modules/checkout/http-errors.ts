import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Subject } from '../auth/token.service';

/** Same answer for "no such booking" and "someone else's booking": existence never leaks. */
export const bookingNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });

export const conflict = (code: string, message: string): ConflictException =>
  new ConflictException({ code, message });

/** Booking endpoints are for client accounts; photographers and staff have their own surfaces. */
export function requireUser(subject: Subject): string {
  if (subject.kind !== 'USER') {
    throw new ForbiddenException({
      code: 'CLIENTS_ONLY',
      message: 'Only client accounts can book',
    });
  }
  return subject.id;
}

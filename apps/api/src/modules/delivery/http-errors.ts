import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';

export const bookingNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });

export const linkNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'LINK_NOT_FOUND', message: 'This link does not exist' });

export const linkExpired = (): GoneException =>
  new GoneException({ code: 'LINK_EXPIRED', message: 'This link has expired' });

export const conflict = (code: string, message: string, details?: unknown): ConflictException =>
  new ConflictException(details === undefined ? { code, message } : { code, message, details });

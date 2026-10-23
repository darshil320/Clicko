import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Subject } from '../auth/token.service';

/** Same answer for "no such assignment" and "someone else's": existence never leaks. */
export const assignmentNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' });

export const bookingNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });

export const conflict = (code: string, message: string, details?: unknown): ConflictException =>
  new ConflictException(details === undefined ? { code, message } : { code, message, details });

export const unprocessable = (
  code: string,
  message: string,
  details?: unknown,
): UnprocessableEntityException =>
  new UnprocessableEntityException(
    details === undefined ? { code, message } : { code, message, details },
  );

export const assignmentNotActive = (): ConflictException =>
  conflict('ASSIGNMENT_NOT_ACTIVE', 'This assignment is no longer active');

export const wrongStage = (status: string): ConflictException =>
  conflict('WRONG_STAGE', `This cannot be done while the booking is ${status}`);

/** ProGuard has already checked the kind; this narrows the type for the service call. */
export function photographerId(subject: Subject): string {
  if (subject.kind !== 'PHOTOGRAPHER') {
    throw new ForbiddenException({
      code: 'PHOTOGRAPHERS_ONLY',
      message: 'Only photographer accounts can use this',
    });
  }
  return subject.id;
}

export function requireUser(subject: Subject): string {
  if (subject.kind !== 'USER') {
    throw new ForbiddenException({
      code: 'CLIENTS_ONLY',
      message: 'Only client accounts can do this',
    });
  }
  return subject.id;
}

export const extensionNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'EXTENSION_NOT_FOUND',
    message: 'No such extension request on this booking',
  });

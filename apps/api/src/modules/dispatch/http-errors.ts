import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Subject } from '../auth/token.service';

export const conflict = (code: string, message: string): ConflictException =>
  new ConflictException({ code, message });

/** Same answer for "no such offer" and "someone else's offer": existence never leaks. */
export const offerNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });

export const assignmentNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' });

export const accountInactive = (): ForbiddenException =>
  new ForbiddenException({
    code: 'ACCOUNT_INACTIVE',
    message: 'Your account is not active — contact Clickco support',
  });

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

import { ConflictException, NotFoundException } from '@nestjs/common';

/** Someone else's booking answers exactly like a missing one. */
export const bookingNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });

export const reviewNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'REVIEW_NOT_FOUND', message: 'Review not found' });

export const notDeliveredYet = (): ConflictException =>
  new ConflictException({
    code: 'BOOKING_NOT_DELIVERED',
    message: 'You can rate a booking once its photos are delivered',
  });

export const editWindowClosed = (): ConflictException =>
  new ConflictException({
    code: 'REVIEW_EDIT_WINDOW_CLOSED',
    message: 'Reviews can be edited for 7 days after you write them',
  });

export const reviewUnderModeration = (): ConflictException =>
  new ConflictException({
    code: 'REVIEW_UNDER_MODERATION',
    message:
      'This review was reported and Clickco is checking it. You can edit it once that is done.',
  });

export const reviewModerated = (): ConflictException =>
  new ConflictException({
    code: 'REVIEW_MODERATED',
    message: 'Clickco has checked this review, so it can no longer be edited',
  });

export const reviewHidden = (): ConflictException =>
  new ConflictException({
    code: 'REVIEW_HIDDEN',
    message: 'This review was hidden by Clickco and can no longer be edited',
  });

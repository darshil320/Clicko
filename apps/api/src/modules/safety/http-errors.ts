import {
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/** Someone else's booking, or one the two people did not share, answers like a missing one. */
export const bookingNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });

export const reviewNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'REVIEW_NOT_FOUND', message: 'Review not found' });

export const photographerNotFound = (): NotFoundException =>
  new NotFoundException({
    code: 'PHOTOGRAPHER_NOT_FOUND',
    message: 'This photographer has not worked on one of your bookings',
  });

export const reportNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Report not found' });

export const targetNotAllowed = (): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'REPORT_TARGET_NOT_ALLOWED',
    message: 'You can report a review, or the person you shared a booking with',
  });

export const cannotReportYourself = (): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'CANNOT_REPORT_YOURSELF',
    message: 'You cannot report yourself or your own review',
  });

export const reportAlreadyOpen = (): ConflictException =>
  new ConflictException({
    code: 'REPORT_ALREADY_OPEN',
    message: 'You have already reported this. Our team is looking into it.',
  });

export const reportsRateLimited = (): HttpException =>
  new HttpException(
    { code: 'RATE_LIMITED', message: 'Too many reports today. Please try again tomorrow.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

export const reportAlreadyDecided = (): ConflictException =>
  new ConflictException({
    code: 'REPORT_ALREADY_DECIDED',
    message: 'This report has already been decided',
  });

export const decisionNotAllowed = (allowed: readonly string[]): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'DECISION_NOT_ALLOWED',
    message: 'That decision does not fit this report',
    details: { allowed },
  });

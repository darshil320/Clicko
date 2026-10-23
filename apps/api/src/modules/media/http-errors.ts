import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

const body = (code: string, message: string, details?: unknown) =>
  details === undefined ? { code, message } : { code, message, details };

export const badRequest = (code: string, message: string, details?: unknown) =>
  new BadRequestException(body(code, message, details));

export const conflict = (code: string, message: string, details?: unknown) =>
  new ConflictException(body(code, message, details));

export const unprocessable = (code: string, message: string, details?: unknown) =>
  new UnprocessableEntityException(body(code, message, details));

export const unavailable = (code: string, message: string) =>
  new ServiceUnavailableException(body(code, message));

/** Same answer for "no such booking" and "not your booking": existence never leaks. */
export const bookingNotFound = () =>
  new NotFoundException(body('BOOKING_NOT_FOUND', 'Booking not found'));

export const sessionNotFound = () =>
  new NotFoundException(body('UPLOAD_SESSION_NOT_FOUND', 'Upload session not found'));

export const fileNotFound = () =>
  new NotFoundException(body('UPLOAD_FILE_NOT_FOUND', 'That file is not part of this upload'));

export const lengthRequired = () =>
  new HttpException(
    body('LENGTH_REQUIRED', 'Send each part with a Content-Length header'),
    HttpStatus.LENGTH_REQUIRED,
  );

export const unsupportedMediaType = () =>
  new HttpException(
    body('UNSUPPORTED_MEDIA_TYPE', 'Send parts as application/octet-stream'),
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  );

export const storageUnavailable = () =>
  unavailable(
    'STORAGE_NOT_CONFIGURED',
    'Uploads are paused while storage is being set up — try again later',
  );

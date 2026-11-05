import type { CancellationBlock } from '@clickco/contracts';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { rupees } from '../refunds/refund-rules';
import { blockReason } from './rules/ladder';

/** Same answer for "no such booking" and "someone else's booking": existence never leaks. */
export const bookingNotFound = (): NotFoundException =>
  new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });

const BLOCK_CODES: Readonly<Record<CancellationBlock, string>> = {
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  SHOOT_STARTED: 'CANCEL_NOT_AVAILABLE',
  SHOOT_TIME_PASSED: 'CANCEL_NOT_AVAILABLE',
  PAYMENT_SETTLING: 'CANCEL_PAYMENT_SETTLING',
  NOT_CANCELLABLE: 'CANCEL_NOT_AVAILABLE',
};

export const cancellationBlocked = (block: CancellationBlock): ConflictException =>
  new ConflictException({ code: BLOCK_CODES[block], message: blockReason(block) });

/** A paid booking is cancelled only against the refund the client saw and confirmed. */
export const confirmationRequired = (): UnprocessableEntityException =>
  new UnprocessableEntityException({
    code: 'CANCELLATION_CONFIRMATION_REQUIRED',
    message: 'Check what comes back first, then confirm that amount to cancel',
  });

/** The band moved (a boundary passed, a photographer accepted) since the client's quote. */
export const termsChanged = (refundPaise: bigint): ConflictException =>
  new ConflictException({
    code: 'CANCELLATION_TERMS_CHANGED',
    message: `Cancelling now returns ${rupees(refundPaise)}. Check the new amount and confirm again.`,
  });

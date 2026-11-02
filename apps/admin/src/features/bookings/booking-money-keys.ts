import { keys } from '../../shared/query';

/** Under the booking's key, so anything that refreshes the booking refreshes its money too. */
export const bookingMoneyKey = (bookingId: string) =>
  [...keys.booking(bookingId), 'money'] as const;

/** A refund asked for or a credit issued: the money desks, the booking and Today's counts. */
export const MONEY_INVALIDATE = [['money'], keys.bookingAll, keys.overview] as const;

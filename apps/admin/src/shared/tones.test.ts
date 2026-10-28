import { BookingStatus } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  alertTone,
  bookingTone,
  clockTone,
  emergencyTone,
  flagTone,
  offerTone,
  qaTone,
} from './tones';

describe('badge tones', () => {
  it('gives every booking status a tone, and never the emergency colour', () => {
    for (const status of BookingStatus.options) {
      expect(bookingTone(status)).toBeTruthy();
      expect(bookingTone(status)).not.toBe('emergency');
    }
    expect(bookingTone('DELIVERED')).toBe('success');
    expect(bookingTone('PRO_NO_SHOW')).toBe('destructive');
  });

  it('keeps the emergency colour for emergency bookings only', () => {
    expect(emergencyTone('NONE')).toBeNull();
    expect(emergencyTone('SAME_DAY')).toBe('emergency');
  });

  it('marks breaches, reviews and alerts', () => {
    expect(flagTone('SLA_BREACHED')).toBe('destructive');
    expect(flagTone('NEEDS_REVIEW')).toBe('warning');
    expect(flagTone('SOMETHING_NEW')).toBe('neutral');
    expect(clockTone('BREACHED')).toBe('destructive');
    expect(qaTone('PASSED')).toBe('success');
    expect(alertTone('ops.alert')).toBe('destructive');
    expect(alertTone('booking.needs_review')).toBe('warning');
    expect(offerTone('ACCEPTED')).toBe('success');
    expect(offerTone('PENDING')).toBe('warning');
  });
});

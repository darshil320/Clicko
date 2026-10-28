import { describe, expect, it } from 'vitest';
import {
  formatBps,
  formatCode,
  formatDate,
  formatDateTime,
  formatDay,
  formatDue,
  formatEmergencyBand,
  formatHours,
  formatMinutes,
  formatMoney,
  formatPhone,
  formatTime,
  initials,
  istDay,
} from './format';

describe('content rules (DESIGN.md)', () => {
  it('formats rupees with Indian grouping from paise', () => {
    expect(formatMoney(1153450)).toBe('₹11,535');
    expect(formatMoney(1153450, true)).toBe('₹11,534.50');
    expect(formatMoney(12000000_00)).toBe('₹1,20,00,000');
    expect(formatMoney(0)).toBe('₹0');
  });

  it('shows dates as DD MMM and 12-hour times in IST', () => {
    const at = '2026-09-14T11:00:00Z'; // 4:30 pm IST
    expect(formatDate(at)).toBe('14 Sep');
    expect(formatTime(at)).toBe('4:30 pm');
    expect(formatDateTime(at)).toBe('14 Sep, 4:30 pm');
    expect(formatTime('2026-09-14T00:05:00+05:30')).toBe('12:05 am');
  });

  it('reads IST calendar days', () => {
    expect(formatDay('2026-11-14')).toBe('14 Nov');
    // 20:00 UTC on 13 Nov is already 14 Nov in India.
    expect(istDay(Date.parse('2026-11-13T20:00:00Z'))).toBe('2026-11-14');
  });

  it('turns codes into words', () => {
    expect(formatCode('QUALITY_ESCALATION')).toBe('Quality escalation');
    expect(formatCode('ops.alert')).toBe('Ops alert');
    expect(formatCode('PHOTOGRAPHER')).toBe('Photographer');
  });

  it('formats durations, hours and deadlines', () => {
    expect(formatMinutes(80)).toBe('1 h 20 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatHours(1)).toBe('1 hr');
    expect(formatHours(2.5)).toBe('2.5 hrs');
    const now = Date.parse('2026-11-14T10:00:00+05:30');
    expect(formatDue('2026-11-14T12:05:00+05:30', now)).toEqual({
      text: 'in 2 h 5 min',
      overdue: false,
    });
    expect(formatDue('2026-11-14T09:35:00+05:30', now)).toEqual({
      text: '25 min overdue',
      overdue: true,
    });
  });

  it('formats basis points, phones and initials', () => {
    expect(formatBps(2500)).toBe('25%');
    expect(formatBps(1250)).toBe('12.5%');
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone('+91******3210')).toBe('+91******3210');
    expect(initials('Vikram Reddy')).toBe('VR');
    expect(initials('  ')).toBe('?');
  });
});

describe('formatEmergencyBand', () => {
  it('names the lead-time bands the way ops say them', () => {
    expect(formatEmergencyBand('HOURS_3_8')).toBe('Emergency · 3–8 h');
    expect(formatEmergencyBand('HOURS_UNDER_3')).toBe('Emergency · under 3 h');
    expect(formatEmergencyBand('NEXT_DAY')).toBe('Next day');
    expect(formatEmergencyBand('NONE')).toBe('None');
  });
});

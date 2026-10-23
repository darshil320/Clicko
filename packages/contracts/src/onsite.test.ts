import { describe, expect, it } from 'vitest';
import {
  AssignmentEventId,
  BookingDetail,
  CheckOutBody,
  ClientAbsentBody,
  GeoFixBody,
  LogWaitingBody,
  OnsiteChargeAmounts,
  ProEarnings,
  RequestExtensionBody,
} from './index.js';

const fix = { lat: 21.1702, lng: 72.8311, accuracyM: 12 };

describe('on-site contracts (ADR-0013)', () => {
  it('a fix defaults to online and refuses impossible coordinates or accuracy', () => {
    expect(GeoFixBody.parse(fix)).toEqual({ ...fix, offline: false });
    expect(GeoFixBody.safeParse({ ...fix, lat: 91 }).success).toBe(false);
    expect(GeoFixBody.safeParse({ ...fix, accuracyM: 0 }).success).toBe(false);
    expect(GeoFixBody.safeParse({ ...fix, deviceTs: 'yesterday' }).success).toBe(false);
  });

  it('check-out needs a whole, non-negative frame count; client-absent needs a note', () => {
    expect(CheckOutBody.safeParse({ ...fix, declaredFrameCount: 240 }).success).toBe(true);
    expect(CheckOutBody.safeParse({ ...fix, declaredFrameCount: 2.5 }).success).toBe(false);
    expect(CheckOutBody.safeParse({ ...fix }).success).toBe(false);
    expect(ClientAbsentBody.safeParse({ ...fix, note: 'no' }).success).toBe(false);
  });

  it('extensions are one-hour blocks only', () => {
    expect(RequestExtensionBody.safeParse({ hours: 1 }).success).toBe(true);
    expect(RequestExtensionBody.safeParse({ hours: 2 }).success).toBe(false);
  });

  it('waiting minutes are whole and bounded', () => {
    const base = { note: 'Client late', lat: 21.17, lng: 72.83 };
    expect(LogWaitingBody.safeParse({ ...base, minutes: 40 }).success).toBe(true);
    expect(LogWaitingBody.safeParse({ ...base, minutes: 0 }).success).toBe(false);
    expect(LogWaitingBody.safeParse({ ...base, minutes: 12.5 }).success).toBe(false);
  });

  it('event ids are positive decimal strings', () => {
    expect(AssignmentEventId.safeParse('42').success).toBe(true);
    expect(AssignmentEventId.safeParse('0').success).toBe(false);
    expect(AssignmentEventId.safeParse('4e2').success).toBe(false);
  });

  it('charges and earnings are integer paise', () => {
    const amounts = {
      taxablePaise: 488_750,
      gstPaise: 87_975,
      cgstPaise: 43_988,
      sgstPaise: 43_987,
      igstPaise: 0,
      totalPaise: 576_725,
    };
    expect(OnsiteChargeAmounts.safeParse(amounts).success).toBe(true);
    expect(OnsiteChargeAmounts.safeParse({ ...amounts, totalPaise: 576_725.5 }).success).toBe(
      false,
    );
    expect(
      ProEarnings.safeParse({
        basis: 'EXPECTED',
        asOf: '2026-11-15T12:00:00.000Z',
        todayPaise: 1.5,
        weekPaise: 0,
        monthPaise: 0,
        pendingPayoutPaise: 0,
        jobs: [],
      }).success,
    ).toBe(false);
  });

  it('BookingDetail still parses without the on-site fields (older API responses)', () => {
    const detail = BookingDetail.parse({
      booking: {
        id: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
        reference: 'CLK-1001',
        status: 'IN_PROGRESS',
        tier: 'PROFESSIONAL',
        categoryCode: 'FOOD',
        cityName: 'Surat',
        scheduledStart: '2026-11-15T06:30:00.000Z',
        scheduledHours: 2,
        emergencyBand: 'NONE',
        venueAddress: '4 Athwalines',
        totalPaise: 1_000_000,
        advancePaise: 500_000,
        balancePaise: 500_000,
        amountPaidPaise: 500_000,
        quoteExpiresAt: null,
        createdAt: '2026-11-10T06:30:00.000Z',
      },
      timeline: [],
      invoices: [],
    });
    expect(detail.pendingExtensions).toBeUndefined();
    expect(detail.charges).toBeUndefined();
  });
});

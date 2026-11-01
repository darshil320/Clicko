import { describe, expect, it } from 'vitest';
import { maskPhone, maskPushToken } from '../masking';
import { DEFAULT_PREFERENCES, planChannels, sendableAt } from '../pipeline/channel-plan';
import type { Channel } from '../templates/templates';

const ALL: readonly Channel[] = ['WHATSAPP', 'SMS', 'PUSH'];
const ist = (hhmm: string, day = '2026-11-14') => new Date(`${day}T${hhmm}:00+05:30`);

describe('quiet hours 21:00–08:00 IST (ADR-0027 D2)', () => {
  it('transactional messages go at any hour', () => {
    expect(sendableAt('transactional', ist('23:30'))).toEqual(ist('23:30'));
    expect(sendableAt('transactional', ist('03:00'))).toEqual(ist('03:00'));
  });

  it('a utility message waits for 08:00 IST', () => {
    expect(sendableAt('utility', ist('21:00'))).toEqual(ist('08:00', '2026-11-15'));
    expect(sendableAt('utility', ist('23:59'))).toEqual(ist('08:00', '2026-11-15'));
    expect(sendableAt('utility', ist('00:10'))).toEqual(ist('08:00'));
    expect(sendableAt('utility', ist('07:59'))).toEqual(ist('08:00'));
  });

  it('a utility message in the day goes now', () => {
    expect(sendableAt('utility', ist('08:00'))).toEqual(ist('08:00'));
    expect(sendableAt('utility', ist('20:59'))).toEqual(ist('20:59'));
  });
});

describe('per-recipient channel plan', () => {
  const transactional = { channels: ALL, category: 'transactional' as const };
  const utility = { channels: ALL, category: 'utility' as const };

  it('SMS without a WhatsApp opt-in; push only with a registered device', () => {
    expect(planChannels(transactional, DEFAULT_PREFERENCES, 0)).toEqual({
      messaging: ['SMS'],
      push: false,
      skipReason: null,
    });
    expect(planChannels(transactional, DEFAULT_PREFERENCES, 2).push).toBe(true);
  });

  it('WhatsApp first once opted in, SMS as the fallback', () => {
    const prefs = { ...DEFAULT_PREFERENCES, whatsappOptIn: true };
    expect(planChannels(transactional, prefs, 0).messaging).toEqual(['WHATSAPP', 'SMS']);
  });

  it('mutes silence utility messages only', () => {
    const muted = {
      whatsappOptIn: true,
      muteWhatsapp: true,
      muteSms: true,
      mutePush: true,
    };
    expect(planChannels(utility, muted, 1)).toEqual({
      messaging: [],
      push: false,
      skipReason: 'OPTED_OUT',
    });
    expect(planChannels(transactional, muted, 1)).toEqual({
      messaging: ['WHATSAPP', 'SMS'],
      push: true,
      skipReason: null,
    });
  });

  it('a push-only template without a device has no channel', () => {
    expect(
      planChannels({ channels: ['PUSH'], category: 'transactional' }, DEFAULT_PREFERENCES, 0),
    ).toEqual({ messaging: [], push: false, skipReason: 'NO_CHANNEL' });
  });
});

describe('masking', () => {
  it('never shows more than the last four digits of a phone', () => {
    expect(maskPhone('+919812345678')).toBe('******5678');
    expect(maskPhone('12')).toBe('******');
  });

  it('shows only the tail of a push token', () => {
    expect(maskPushToken('ExponentPushToken[abcdefghijklmnopWXYZ]')).toBe(
      'ExponentPushToken[…WXYZ]',
    );
    expect(maskPushToken('garbage')).toBe('ExponentPushToken[…]');
  });
});

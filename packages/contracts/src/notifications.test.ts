import { describe, expect, it } from 'vitest';
import {
  ExpoPushToken,
  MaskedCallResponse,
  NotificationPreferencesView,
  RegisterPushTokenBody,
  RegisterPushTokenResponse,
  UnregisterPushTokenBody,
  UnregisterPushTokenResponse,
  UpdateNotificationPreferencesBody,
} from './notifications.js';

describe('notification contracts (ADR-0027)', () => {
  it('accepts Expo push tokens only', () => {
    expect(ExpoPushToken.safeParse('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]').success).toBe(true);
    expect(ExpoPushToken.safeParse('ExpoPushToken[abcDEF012345_-]').success).toBe(true);
    expect(ExpoPushToken.safeParse('fcm:raw-device-token').success).toBe(false);
    expect(ExpoPushToken.safeParse('ExponentPushToken[short]').success).toBe(false);
  });

  it('a token registration names its platform', () => {
    const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
    expect(RegisterPushTokenBody.safeParse({ token, platform: 'ios' }).success).toBe(true);
    expect(RegisterPushTokenBody.safeParse({ token, platform: 'web' }).success).toBe(false);
  });

  it('a registration may be refused (token live on another account)', () => {
    const answer = { platform: 'ios', lastSeenAt: '2026-11-14T10:00:00+05:30' };
    expect(RegisterPushTokenResponse.safeParse({ ...answer, registered: true }).success).toBe(true);
    expect(RegisterPushTokenResponse.safeParse({ ...answer, registered: false }).success).toBe(
      true,
    );
  });

  it('unregistering takes an Expo token and always answers the same', () => {
    const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
    expect(UnregisterPushTokenBody.safeParse({ token }).success).toBe(true);
    expect(UnregisterPushTokenBody.safeParse({ token: 'not-a-token' }).success).toBe(false);
    expect(UnregisterPushTokenResponse.safeParse({ unregistered: true }).success).toBe(true);
    expect(UnregisterPushTokenResponse.safeParse({ unregistered: false }).success).toBe(false);
  });

  it('a preferences view carries every switch and when it last changed', () => {
    const view = {
      whatsappOptIn: true,
      muteWhatsapp: false,
      muteSms: false,
      mutePush: true,
      updatedAt: '2026-11-14T10:00:00+05:30',
    };
    expect(NotificationPreferencesView.safeParse(view).success).toBe(true);
    expect(NotificationPreferencesView.safeParse({ ...view, updatedAt: null }).success).toBe(true);
    expect(NotificationPreferencesView.safeParse({ ...view, mutePush: undefined }).success).toBe(
      false,
    );
  });

  it('a preferences update changes at least one known field', () => {
    expect(UpdateNotificationPreferencesBody.safeParse({ muteSms: true }).success).toBe(true);
    expect(UpdateNotificationPreferencesBody.safeParse({}).success).toBe(false);
    expect(UpdateNotificationPreferencesBody.safeParse({ muteEmail: true }).success).toBe(false);
  });

  it('a masked call answer carries the virtual number, never a real one by shape', () => {
    const ok = MaskedCallResponse.safeParse({
      bookingId: '7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f',
      callId: '8e0a4d2b-3c5f-4d9e-8a21-2b3c4d5e6f70',
      virtualNumber: '08047112233',
      status: 'CONNECTING',
    });
    expect(ok.success).toBe(true);
  });
});

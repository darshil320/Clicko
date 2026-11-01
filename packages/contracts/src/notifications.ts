import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * Notifications and masked calls (ADR-0027 D1–D3). The apps register an Expo push token after
 * sign-in, read and change their notification preferences, and ask for a masked call. Real phone
 * numbers never cross this surface: a call is bridged by the provider through a virtual number.
 */

// ── Push tokens ─────────────────────────────────────────────────────────────

/** An Expo push token as expo-notifications returns it (`ExponentPushToken[…]`). */
export const ExpoPushToken = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/, 'must be an Expo push token');
export type ExpoPushToken = z.infer<typeof ExpoPushToken>;

export const PushPlatform = z.enum(['ios', 'android']);
export type PushPlatform = z.infer<typeof PushPlatform>;

/** POST /me/push-tokens (client) and POST /pro/push-tokens (Pro): register or refresh. */
export const RegisterPushTokenBody = z.object({
  token: ExpoPushToken,
  platform: PushPlatform,
});
export type RegisterPushTokenBody = z.infer<typeof RegisterPushTokenBody>;

/**
 * `registered: false`: another account holds this token live and saw it recently — it was
 * revoked rather than moved. Registering again (the app does on its next start) moves it.
 */
export const RegisterPushTokenResponse = z.object({
  registered: z.boolean(),
  platform: PushPlatform,
  lastSeenAt: IsoDateTime,
});
export type RegisterPushTokenResponse = z.infer<typeof RegisterPushTokenResponse>;

/**
 * POST /me/push-tokens/unregister and POST /pro/push-tokens/unregister: on sign-out. Only the
 * caller's own token is revoked; the answer is the same whether or not it was registered.
 */
export const UnregisterPushTokenBody = z.object({ token: ExpoPushToken });
export type UnregisterPushTokenBody = z.infer<typeof UnregisterPushTokenBody>;

export const UnregisterPushTokenResponse = z.object({ unregistered: z.literal(true) });
export type UnregisterPushTokenResponse = z.infer<typeof UnregisterPushTokenResponse>;

// ── Preferences ─────────────────────────────────────────────────────────────

/**
 * What the user controls. Transactional messages (booking, payment, delivery, refund) always go;
 * the mutes apply to non-essential ones only (reminders). WhatsApp needs an explicit opt-in
 * (Meta Business policy); without it, messages go by SMS.
 */
export const NotificationPreferences = z.object({
  whatsappOptIn: z.boolean(),
  muteWhatsapp: z.boolean(),
  muteSms: z.boolean(),
  mutePush: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

/** GET /me/notification-preferences (client) and GET /pro/notification-preferences (Pro). */
export const NotificationPreferencesView = NotificationPreferences.extend({
  updatedAt: IsoDateTime.nullable(),
});
export type NotificationPreferencesView = z.infer<typeof NotificationPreferencesView>;

/**
 * POST /me/notification-preferences (client) and POST /pro/notification-preferences (Pro): any
 * subset; omitted fields keep their value. Answers NotificationPreferencesView.
 */
export const UpdateNotificationPreferencesBody = NotificationPreferences.partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type UpdateNotificationPreferencesBody = z.infer<typeof UpdateNotificationPreferencesBody>;

// ── Masked calls ────────────────────────────────────────────────────────────

/**
 * POST /bookings/:id/call (client) and POST /pro/assignments/:id/call (Pro). The provider rings
 * the caller first, from `virtualNumber`, then connects the other side — who also sees only
 * `virtualNumber`. Open from assignment until 2 hours after check-out.
 */
export const MaskedCallResponse = z.object({
  bookingId: Uuid,
  callId: Uuid,
  virtualNumber: z.string().regex(/^\+?[0-9]{8,15}$/),
  status: z.literal('CONNECTING'),
});
export type MaskedCallResponse = z.infer<typeof MaskedCallResponse>;

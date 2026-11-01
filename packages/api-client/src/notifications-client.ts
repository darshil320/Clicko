import {
  MaskedCallResponse,
  NotificationPreferencesView,
  type RegisterPushTokenBody,
  RegisterPushTokenResponse,
  UnregisterPushTokenResponse,
  type UpdateNotificationPreferencesBody,
} from '@clickco/contracts';
import type { Http } from './http.js';

/**
 * ADR-0027 D2: the app install's Expo push token and the account's notification preferences.
 * The client app uses `/me`, the Pro app `/pro`; the routes are otherwise the same.
 */
export function notificationSettingsApi(http: Http, prefix: '/me' | '/pro') {
  return {
    /** After sign-in and whenever Expo hands out a new token; moves it to this account. */
    registerPushToken: (body: RegisterPushTokenBody) =>
      http.request({
        method: 'POST',
        path: `${prefix}/push-tokens`,
        body,
        schema: RegisterPushTokenResponse,
        auth: true,
      }),
    /** On sign-out, before the session is dropped. */
    unregisterPushToken: (token: string) =>
      http.request({
        method: 'POST',
        path: `${prefix}/push-tokens/unregister`,
        body: { token },
        schema: UnregisterPushTokenResponse,
        auth: true,
      }),
    preferences: () =>
      http.request({
        method: 'GET',
        path: `${prefix}/notification-preferences`,
        schema: NotificationPreferencesView,
        auth: true,
      }),
    /** Any subset; omitted switches keep their value. */
    updatePreferences: (body: UpdateNotificationPreferencesBody) =>
      http.request({
        method: 'POST',
        path: `${prefix}/notification-preferences`,
        body,
        schema: NotificationPreferencesView,
        auth: true,
      }),
  };
}

/**
 * ADR-0027 D3: asks for a masked call. The provider rings this phone first, from the virtual
 * number in the answer, then connects the other side; neither sees the other's number.
 */
export const startMaskedCall = (http: Http, path: string) =>
  http.request({ method: 'POST', path, schema: MaskedCallResponse, auth: true });

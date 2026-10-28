import * as Location from 'expo-location';
import { type DeviceFix, toDeviceFix } from './fix';

/** A fresh fix can take a while indoors; past this, tell the photographer instead of spinning. */
const FIX_TIMEOUT_MS = 20_000;

export type FixFailure = 'PERMISSION_DENIED' | 'SERVICES_OFF' | 'TIMEOUT' | 'UNAVAILABLE';

export type FixResult =
  | { readonly ok: true; readonly fix: DeviceFix }
  | { readonly ok: false; readonly reason: FixFailure; readonly message: string };

const FAILURE_MESSAGE: Readonly<Record<FixFailure, string>> = {
  PERMISSION_DENIED: 'Allow location for Clickco Pro in Settings to check in and out.',
  SERVICES_OFF: 'Turn on location services to check in and out.',
  TIMEOUT: 'Could not get a GPS fix. Step outside or near a window and try again.',
  UNAVAILABLE: 'Your location is not available right now. Try again in a moment.',
};

const failure = (reason: FixFailure): FixResult => ({
  ok: false,
  reason,
  message: FAILURE_MESSAGE[reason],
});

/** Foreground only, high accuracy, a fresh fix (never a cached one) — ADR-0024 D4. */
export async function currentFix(): Promise<FixResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') return failure('PERMISSION_DENIED');
  if (!(await Location.hasServicesEnabledAsync())) return failure('SERVICES_OFF');

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
  });
  try {
    const raw = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      timeout,
    ]);
    if (raw === null) return failure('TIMEOUT');
    const fix = toDeviceFix(raw);
    return fix ? { ok: true, fix } : failure('UNAVAILABLE');
  } catch {
    return failure('UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

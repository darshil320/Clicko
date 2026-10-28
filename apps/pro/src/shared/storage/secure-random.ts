/** Where secure randomness can come from; `globalThis` on a device or in a browser. */
export interface RandomSource {
  readonly crypto?: { getRandomValues?: <T extends ArrayBufferView>(array: T) => T };
  readonly expo?: { uuidv4?: () => string };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Cryptographically secure random bytes. Never Math.random: these bytes become an encryption key.
 *
 * - Web Crypto's getRandomValues when the runtime has it (browsers, Node).
 * - Otherwise Expo's native `uuidv4`, which expo-modules-core installs on `globalThis.expo` (Hermes
 *   has no Web Crypto and the apps carry no polyfill). It is Foundation's UUID() on iOS and
 *   java.util.UUID.randomUUID() (SecureRandom) on Android. In a v4 UUID every hex digit except the
 *   version and variant digits is uniformly random: 30 digits, 15 bytes per UUID.
 * - Neither: throw. The store is not opened rather than opened with a guessable key.
 */
export function secureRandomBytes(
  length: number,
  source: RandomSource = globalThis as RandomSource,
): Uint8Array {
  const crypto = source.crypto;
  if (crypto?.getRandomValues) return crypto.getRandomValues(new Uint8Array(length));
  const uuidv4 = source.expo?.uuidv4;
  if (uuidv4) return bytesFromUuids(length, uuidv4);
  throw new Error('No cryptographically secure random source is available');
}

function bytesFromUuids(length: number, uuidv4: () => string): Uint8Array {
  let hex = '';
  while (hex.length < length * 2) {
    const uuid = uuidv4();
    if (!UUID_V4.test(uuid)) throw new Error('expo.uuidv4 did not return a version 4 UUID');
    const digits = uuid.replace(/-/g, '');
    // Drop digit 12 (the version, always 4) and digit 16 (the variant, top two bits fixed).
    hex += digits.slice(0, 12) + digits.slice(13, 16) + digits.slice(17);
  }
  return Uint8Array.from({ length }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

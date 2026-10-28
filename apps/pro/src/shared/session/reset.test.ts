import { describe, expect, it, vi } from 'vitest';
import { onSessionEnd, runSessionEndResets } from './reset';

describe('session-end resets', () => {
  it('runs every registered reset, and stops running one once unregistered', () => {
    const draft = vi.fn();
    const cache = vi.fn();
    const offDraft = onSessionEnd(draft);
    const offCache = onSessionEnd(cache);

    runSessionEndResets();
    expect(draft).toHaveBeenCalledTimes(1);
    expect(cache).toHaveBeenCalledTimes(1);

    offDraft();
    runSessionEndResets();
    expect(draft).toHaveBeenCalledTimes(1);
    expect(cache).toHaveBeenCalledTimes(2);
    offCache();
  });
});

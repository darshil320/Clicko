import 'reflect-metadata';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { IdempotencyInterceptor } from '../idempotency.interceptor';
import type { IdempotencyStore } from '../idempotency.store';
import { IDEMPOTENCY_TTL_MS, Idempotent } from '../idempotent.decorator';

const NOW = new Date('2026-11-10T06:30:00.000Z');

class Routes {
  @Idempotent({ ttlMs: 600_000 })
  accept() {}

  @Idempotent()
  pay() {}
}

function run(handler: () => void, subject: { kind: string; id: string }) {
  const store = {
    claim: vi.fn(async () => ({ kind: 'CLAIMED' })),
    complete: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const req = {
    method: 'POST',
    path: '/pro/offers/a/accept',
    headers: { 'idempotency-key': 'key-0001-abcd' },
    body: {},
    subject,
  };
  const res = { statusCode: 200, status: vi.fn(), setHeader: vi.fn() };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of({ ok: true }) };
  const interceptor = new IdempotencyInterceptor(store as unknown as IdempotencyStore, () => NOW);
  return { store, done: interceptor.intercept(ctx, next) };
}

describe('@Idempotent options (ADR-0012)', () => {
  it('records a per-route TTL as handler metadata', () => {
    expect(Reflect.getMetadata(IDEMPOTENCY_TTL_MS, Routes.prototype.accept)).toBe(600_000);
    expect(Reflect.getMetadata(IDEMPOTENCY_TTL_MS, Routes.prototype.pay)).toBeUndefined();
  });

  it('claims with the route TTL, under a key scoped by subject kind and id', async () => {
    const { store, done } = run(Routes.prototype.accept, { kind: 'PHOTOGRAPHER', id: 'p-1' });
    await done;
    expect(store.claim).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'PHOTOGRAPHER:p-1:key-0001-abcd', ttlMs: 600_000 }),
    );
  });

  it('a USER and a PHOTOGRAPHER with the same id never share a key', async () => {
    const { store, done } = run(Routes.prototype.pay, { kind: 'USER', id: 'p-1' });
    await done;
    const claim = store.claim.mock.calls[0] as unknown as [{ key: string; ttlMs?: number }];
    expect(claim[0].key).toBe('USER:p-1:key-0001-abcd');
    expect(claim[0].ttlMs).toBeUndefined();
  });
});

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { firstValueFrom, lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { IdempotencyInterceptor, requestHash } from '../idempotency.interceptor';
import type { ClaimResult, IdempotencyStore } from '../idempotency.store';

const NOW = new Date('2026-11-10T06:30:00.000Z');

interface FakeReq {
  method: string;
  path: string;
  route: { path: string };
  headers: Record<string, string | undefined>;
  body: unknown;
  subject?: { kind: string; id: string };
}

function harness(claim: ClaimResult, opts: { header?: string | undefined; body?: unknown } = {}) {
  const store = {
    claim: vi.fn(async () => claim),
    complete: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
  const req: FakeReq = {
    method: 'POST',
    path: '/bookings',
    route: { path: '/bookings' },
    headers: { 'idempotency-key': 'header' in opts ? opts.header : 'key-0001-abcd' },
    body: opts.body ?? { tier: 'PROFESSIONAL' },
    subject: { kind: 'USER', id: 'user-1' },
  };
  const res = {
    statusCode: 201,
    status: vi.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    setHeader: vi.fn(),
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  const interceptor = new IdempotencyInterceptor(store as unknown as IdempotencyStore, () => NOW);
  return { store, req, res, ctx, interceptor };
}

const handlerOf = (value: unknown): CallHandler & { handle: ReturnType<typeof vi.fn> } => ({
  handle: vi.fn(() => of(value)),
});

async function statusOf(p: Promise<unknown>): Promise<{ status: number; code?: string }> {
  try {
    await p;
    return { status: 200 };
  } catch (e) {
    if (e instanceof HttpException) {
      const body = e.getResponse() as { code?: string };
      return { status: e.getStatus(), ...(body.code ? { code: body.code } : {}) };
    }
    throw e;
  }
}

describe('IdempotencyInterceptor (G-34)', () => {
  it('requires an Idempotency-Key header', async () => {
    const h = harness({ kind: 'CLAIMED' }, { header: undefined });
    expect(await statusOf(h.interceptor.intercept(h.ctx, handlerOf({})))).toEqual({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(h.store.claim).not.toHaveBeenCalled();
  });

  it('rejects a malformed key', async () => {
    const h = harness({ kind: 'CLAIMED' }, { header: 'no spaces allowed here' });
    expect(await statusOf(h.interceptor.intercept(h.ctx, handlerOf({})))).toEqual({
      status: 400,
      code: 'IDEMPOTENCY_KEY_INVALID',
    });
  });

  it('claims a key scoped to the subject and route, runs the handler and stores the response', async () => {
    const h = harness({ kind: 'CLAIMED' });
    const body = { success: true, data: { id: 'b1' }, error: null };
    const handler = handlerOf(body);
    const out = await lastValueFrom(await h.interceptor.intercept(h.ctx, handler));
    expect(out).toEqual(body);
    expect(h.store.claim).toHaveBeenCalledWith({
      key: 'user-1:key-0001-abcd',
      scope: 'POST /bookings',
      requestHash: requestHash('POST', '/bookings', { tier: 'PROFESSIONAL' }),
      now: NOW,
    });
    expect(h.store.complete).toHaveBeenCalledWith('user-1:key-0001-abcd', 201, body, NOW);
    expect(h.store.release).not.toHaveBeenCalled();
  });

  it('replays the stored status and body without running the handler', async () => {
    const stored = { success: true, data: { id: 'b1' }, error: null };
    const h = harness({ kind: 'REPLAY', status: 201, body: stored });
    const handler = handlerOf({ different: true });
    const out = await firstValueFrom(await h.interceptor.intercept(h.ctx, handler));
    expect(out).toEqual(stored);
    expect(h.res.status).toHaveBeenCalledWith(201);
    expect(h.res.setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('refuses the same key with a different request (422)', async () => {
    const h = harness({ kind: 'MISMATCH' });
    expect(await statusOf(h.interceptor.intercept(h.ctx, handlerOf({})))).toEqual({
      status: 422,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('refuses a concurrent duplicate while the first is in flight (409)', async () => {
    const h = harness({ kind: 'IN_FLIGHT' });
    expect(await statusOf(h.interceptor.intercept(h.ctx, handlerOf({})))).toEqual({
      status: 409,
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    });
  });

  it('releases the key when the handler fails, so a retry can run again', async () => {
    const h = harness({ kind: 'CLAIMED' });
    const failing: CallHandler = { handle: () => throwError(() => new Error('boom')) };
    const obs = await h.interceptor.intercept(h.ctx, failing);
    await expect(lastValueFrom(obs)).rejects.toThrow('boom');
    expect(h.store.release).toHaveBeenCalledWith('user-1:key-0001-abcd');
    expect(h.store.complete).not.toHaveBeenCalled();
  });

  it('hashes method, path and body so any change is a different request', () => {
    const a = requestHash('POST', '/bookings/1/pay', { x: 1 });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(requestHash('POST', '/bookings/1/pay', { x: 1 })).toBe(a);
    expect(requestHash('POST', '/bookings/2/pay', { x: 1 })).not.toBe(a);
    expect(requestHash('POST', '/bookings/1/pay', { x: 2 })).not.toBe(a);
    expect(requestHash('POST', '/bookings/1/pay', undefined)).toBe(
      requestHash('POST', '/bookings/1/pay', null),
    );
  });
});

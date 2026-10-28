import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthGuard } from '../../../common/guards/auth.guard';
import type { Subject } from '../../auth/token.service';
import { CityScopeGuard } from '../access/city-scope.guard';
import { AUDIT_ACTION_KEY, CITY_SCOPED_KEY, ROLES_KEY } from '../access/decorators';
import { StaffGuard } from '../access/staff.guard';
import type { CityResolverPort, StaffAccessPort, StaffPrincipal } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';

const SURAT = '11111111-1111-4111-8111-111111111111';
const MUMBAI = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';
const BOOKING = '44444444-4444-4444-8444-444444444444';

type Req = Record<string, unknown> & {
  method: string;
  headers: Record<string, string>;
  params: Record<string, string>;
};

/** A handler carrying the given metadata, and an ExecutionContext around one request. */
function contextFor(req: Req, metadata: Record<string, unknown>) {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
  const headers = new Map<string, string>();
  const res = { setHeader: (k: string, v: string) => headers.set(k.toLowerCase(), v) };
  const ctx = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

const fakeAuth = (subject: Subject | 'none') =>
  ({
    canActivate: async (ctx: ExecutionContext) => {
      if (subject === 'none') throw new HttpException({ code: 'UNAUTHORIZED' }, 401);
      ctx.switchToHttp().getRequest().subject = subject;
      return true;
    },
  }) as unknown as AuthGuard;

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
};

const principal = (grants: StaffPrincipal['grants']): StaffPrincipal => ({
  id: STAFF_ID,
  email: 'cm@clickco.test',
  fullName: 'City Manager',
  grants,
});

describe('StaffGuard', () => {
  let active: StaffPrincipal | null;
  const access: StaffAccessPort = { activePrincipal: async () => active };
  const req = (): Req => ({ method: 'GET', headers: {}, params: {} });

  beforeEach(() => {
    active = principal([{ id: 'g1', role: 'CITY_MANAGER', cityId: SURAT }]);
  });

  it('needs a session (401 from the auth guard)', async () => {
    const guard = new StaffGuard(fakeAuth('none'), access);
    const { ctx } = contextFor(req(), { [ROLES_KEY]: ['CITY_MANAGER'] });
    expect(await statusOf(guard.canActivate(ctx))).toBe(401);
  });

  it('refuses client and photographer sessions', async () => {
    for (const kind of ['USER', 'PHOTOGRAPHER'] as const) {
      const guard = new StaffGuard(fakeAuth({ kind, id: STAFF_ID }), access);
      const { ctx } = contextFor(req(), { [ROLES_KEY]: ['CITY_MANAGER'] });
      expect(await statusOf(guard.canActivate(ctx)), kind).toBe(403);
    }
  });

  it('refuses a deactivated (or deleted) account at once, whatever its token says', async () => {
    active = null;
    const guard = new StaffGuard(fakeAuth({ kind: 'STAFF', id: STAFF_ID }), access);
    const { ctx } = contextFor(req(), { [ROLES_KEY]: ['CITY_MANAGER'] });
    expect(await statusOf(guard.canActivate(ctx))).toBe(401);
  });

  it('fails closed on a route that declares no roles', async () => {
    const guard = new StaffGuard(fakeAuth({ kind: 'STAFF', id: STAFF_ID }), access);
    const { ctx } = contextFor(req(), {});
    expect(await statusOf(guard.canActivate(ctx))).toBe(403);
  });

  it('refuses a role the route does not allow (403)', async () => {
    const guard = new StaffGuard(fakeAuth({ kind: 'STAFF', id: STAFF_ID }), access);
    const { ctx } = contextFor(req(), { [ROLES_KEY]: ['SUPER_ADMIN'] });
    expect(await statusOf(guard.canActivate(ctx))).toBe(403);
  });

  it('attaches the staff member with the city scope for this route', async () => {
    const guard = new StaffGuard(fakeAuth({ kind: 'STAFF', id: STAFF_ID }), access);
    const r = req();
    const { ctx } = contextFor(r, { [ROLES_KEY]: ['CITY_MANAGER', 'OPS_AGENT'] });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(r.staff).toMatchObject({ id: STAFF_ID, scope: [SURAT] });
  });

  it('SUPER_ADMIN passes any role list, in every city', async () => {
    active = principal([{ id: 'g1', role: 'SUPER_ADMIN', cityId: null }]);
    const guard = new StaffGuard(fakeAuth({ kind: 'STAFF', id: STAFF_ID }), access);
    const r = req();
    const { ctx } = contextFor(r, { [ROLES_KEY]: ['QUALITY_MANAGER'] });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(r.staff).toMatchObject({ scope: 'ALL' });
  });
});

describe('CityScopeGuard', () => {
  const cities: Record<string, string> = { [BOOKING]: SURAT };
  const resolver: CityResolverPort = { cityOf: async (_kind, id) => cities[id] ?? null };
  const scoped = (scope: 'ALL' | string[], id = BOOKING) => {
    const r: Req = {
      method: 'GET',
      headers: {},
      params: { bookingId: id },
      staff: { ...principal([]), scope },
    };
    return contextFor(r, { [CITY_SCOPED_KEY]: { entity: 'booking', param: 'bookingId' } }).ctx;
  };

  it('lets a caller act in a city their grants cover', async () => {
    const guard = new CityScopeGuard(resolver);
    expect(await guard.canActivate(scoped([SURAT]))).toBe(true);
    expect(await guard.canActivate(scoped('ALL'))).toBe(true);
  });

  it("answers another city's booking exactly like a missing one (404)", async () => {
    const guard = new CityScopeGuard(resolver);
    expect(await statusOf(guard.canActivate(scoped([MUMBAI])))).toBe(404);
    expect(await statusOf(guard.canActivate(scoped('ALL', MUMBAI)))).toBe(404);
  });
});

describe('AuditLogInterceptor', () => {
  const interceptor = new AuditLogInterceptor();
  const call = (method: string, metadata: Record<string, unknown>, extra: Partial<Req> = {}) => {
    const r: Req = {
      method,
      headers: { 'user-agent': 'vitest', ...(extra.headers ?? {}) },
      params: {},
      ip: '::ffff:10.1.2.3',
      staff: { ...principal([]), scope: 'ALL' },
      ...extra,
    };
    const { ctx, headers } = contextFor(r, metadata);
    return { r, headers, run: () => interceptor.intercept(ctx, { handle: () => of('done') }) };
  };

  it('refuses to run a mutating handler that is not @Audited', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => call(method, {}).run(), method).toThrow(HttpException);
    }
  });

  it('lets reads through without an action', async () => {
    const { run } = call('GET', {});
    expect(await lastValueFrom(run())).toBe('done');
  });

  it('hands the request context (actor, action, IP, user agent, request id) to the handler', async () => {
    const { r, headers, run } = call('POST', { [AUDIT_ACTION_KEY]: 'qa.decide' });
    await lastValueFrom(run());
    expect(r.audit).toMatchObject({
      action: 'qa.decide',
      actor: { kind: 'STAFF', id: STAFF_ID, email: 'cm@clickco.test' },
      ip: '10.1.2.3',
      userAgent: 'vitest',
    });
    const requestId = (r.audit as { requestId: string }).requestId;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get('x-request-id')).toBe(requestId);
  });

  it('always makes its own request id (a caller cannot choose it) and marks answers no-store', async () => {
    const run = call(
      'POST',
      { [AUDIT_ACTION_KEY]: 'x' },
      { headers: { 'x-request-id': 'req-123_abc' } },
    );
    await lastValueFrom(run.run());
    expect((run.r.audit as { requestId: string }).requestId).not.toBe('req-123_abc');
    expect(run.headers.get('cache-control')).toBe('no-store');
  });
});

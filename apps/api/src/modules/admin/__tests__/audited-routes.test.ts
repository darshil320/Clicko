import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import { DevToolsModule } from '../../../dev/dev-tools.module';
import { AUDIT_ACTION_KEY, ROLES_KEY } from '../access/decorators';
import { StaffGuard } from '../access/staff.guard';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';

type Ctor = abstract new (...args: never[]) => unknown;

/** Every controller reachable from a module (static and dynamic imports). */
function controllersOf(entry: unknown, seen = new Set<unknown>()): Ctor[] {
  if (!entry) return [];
  const dynamic =
    typeof entry === 'object' && 'module' in entry
      ? (entry as { module: object; controllers?: Ctor[]; imports?: unknown[] })
      : null;
  const mod = dynamic ? dynamic.module : (entry as object);
  if (seen.has(mod)) return [];
  seen.add(mod);
  const controllers: Ctor[] = [
    ...(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) ?? []),
    ...(dynamic?.controllers ?? []),
  ];
  const imports: unknown[] = [
    ...(Reflect.getMetadata(MODULE_METADATA.IMPORTS, mod) ?? []),
    ...(dynamic?.imports ?? []),
  ];
  return [...controllers, ...imports.flatMap((m) => controllersOf(m, seen))];
}

interface Route {
  readonly controller: Ctor;
  readonly handler: string;
  readonly method: RequestMethod;
  readonly path: string;
}

function routesOf(controller: Ctor): Route[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
  const proto = (controller as unknown as { prototype: Record<string, unknown> }).prototype;
  return Object.getOwnPropertyNames(proto).flatMap((name) => {
    const fn = proto[name];
    if (typeof fn !== 'function' || name === 'constructor') return [];
    const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, fn);
    if (method === undefined) return [];
    const sub = String(Reflect.getMetadata(PATH_METADATA, fn) ?? '');
    return [
      { controller, handler: name, method, path: `/${[base, sub].filter(Boolean).join('/')}` },
    ];
  });
}

const handlerOf = (r: Route) =>
  (r.controller as unknown as { prototype: Record<string, object> }).prototype[r.handler] as object;

const ALL = [...new Set([...controllersOf(AppModule), ...controllersOf(DevToolsModule)])];
const ADMIN = ALL.flatMap(routesOf).filter((r) => r.path.startsWith('/admin'));
const MUTATING = ADMIN.filter((r) => r.method !== RequestMethod.GET);

describe('every /admin route is guarded and audited (ADR-0025 D3/D4)', () => {
  it('finds the admin surface', () => {
    expect(ADMIN.length).toBeGreaterThanOrEqual(20);
    expect(MUTATING.length).toBeGreaterThanOrEqual(12);
  });

  it.each(MUTATING.map((r) => [`${RequestMethod[r.method]} ${r.path}`, r] as const))(
    '%s carries @Audited',
    (_, route) => {
      expect(typeof Reflect.getMetadata(AUDIT_ACTION_KEY, handlerOf(route))).toBe('string');
    },
  );

  it('every admin controller runs the audit interceptor', () => {
    for (const controller of new Set(ADMIN.map((r) => r.controller))) {
      const interceptors: unknown[] = Reflect.getMetadata(INTERCEPTORS_METADATA, controller) ?? [];
      expect(interceptors, controller.name).toContain(AuditLogInterceptor);
    }
  });

  it('every route outside /admin/auth sits behind StaffGuard with explicit @Roles', () => {
    for (const route of ADMIN.filter((r) => !r.path.startsWith('/admin/auth'))) {
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, route.controller) ?? [];
      expect(guards, route.path).toContain(StaffGuard);
      const roles: unknown = Reflect.getMetadata(ROLES_KEY, handlerOf(route));
      expect(Array.isArray(roles) && roles.length > 0, route.path).toBe(true);
    }
  });

  it('records the actions ADR-0025 D4 names', () => {
    const actions = MUTATING.map((r) => Reflect.getMetadata(AUDIT_ACTION_KEY, handlerOf(r)));
    for (const action of [
      'qa.decide',
      'incident.confirm',
      'breach.attribute',
      'breach.waive',
      'staff.create',
      'staff.grant',
      'staff.deactivate',
      'staff.reset_totp',
      'staff.login',
    ]) {
      expect(actions).toContain(action);
    }
  });
});

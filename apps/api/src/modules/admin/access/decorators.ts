import type { StaffRole } from '@clickco/contracts';
import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { CityScopeGuard } from './city-scope.guard';
import type { AuditContext, ScopedEntity, StaffCaller, StaffRequest } from './staff-context';

export const ROLES_KEY = 'clickco:staff-roles';
export const CITY_SCOPED_KEY = 'clickco:city-scoped';
export const AUDIT_ACTION_KEY = 'clickco:audit-action';

/** The roles that may call this route (SUPER_ADMIN always may). StaffGuard fails closed without it. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

export interface CityScopedSpec {
  readonly entity: ScopedEntity;
  readonly param: string;
}

/** The entity in route param `param` must belong to a city the caller's grants cover (else 404). */
export const CityScoped = (entity: ScopedEntity, param: string) =>
  applyDecorators(
    SetMetadata(CITY_SCOPED_KEY, { entity, param } satisfies CityScopedSpec),
    UseGuards(CityScopeGuard),
  );

/** The audit action this mutation records (ADR-0025 D4). Required on every mutating /admin route. */
export const Audited = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);

/** The caller StaffGuard attached (only on StaffGuard routes). */
export const CurrentStaff = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): StaffCaller => {
    const staff = ctx.switchToHttp().getRequest<StaffRequest>().staff;
    if (!staff) throw new Error('CurrentStaff used on a route without StaffGuard');
    return staff;
  },
);

/** The request context AuditLogInterceptor built. */
export const AuditCtx = createParamDecorator((_: unknown, ctx: ExecutionContext): AuditContext => {
  const audit = ctx.switchToHttp().getRequest<StaffRequest>().audit;
  if (!audit) throw new Error('AuditCtx used on a route without AuditLogInterceptor');
  return audit;
});

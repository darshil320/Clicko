import type { StaffRole } from '@clickco/contracts';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { scopeFor } from './roles';
import { STAFF_ACCESS, type StaffAccessPort, type StaffRequest } from './staff-context';

/** Literal (not imported from decorators.ts) to keep the guard free of a decorator cycle. */
const ROLES_KEY = 'clickco:staff-roles';

const FORBIDDEN = { code: 'FORBIDDEN', message: 'Your role does not allow this' };

/**
 * /admin/* (ADR-0025 D3): a STAFF session whose account is still active, grants loaded fresh
 * for every request (a revoked grant or a deactivation bites at once, not when the 15-minute
 * token expires), and one of the route's @Roles. Attaches the caller and the cities this
 * route's roles open for them. A route without @Roles is refused (fail closed).
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(AuthGuard) private readonly auth: AuthGuard,
    @Inject(STAFF_ACCESS) private readonly access: StaffAccessPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.auth.canActivate(context);
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (req.subject?.kind !== 'STAFF') {
      throw new ForbiddenException({
        code: 'STAFF_ONLY',
        message: 'Only staff accounts can use this',
      });
    }
    const principal = await this.access.activePrincipal(req.subject.id);
    if (!principal) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'This account is not active. Please sign in again.',
      });
    }
    // ADR-0026 D7: a reset, a password change, an authenticator reset or a deactivation ends
    // every session at once — tokens issued before the epoch are refused, not left to expire.
    const epoch = principal.sessionsValidAfter;
    if (epoch && (!req.accessIssuedAt || req.accessIssuedAt < epoch)) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'This session has ended. Please sign in again.',
      });
    }
    const roles: unknown = Reflect.getMetadata(ROLES_KEY, context.getHandler());
    if (!Array.isArray(roles) || roles.length === 0) throw new ForbiddenException(FORBIDDEN);
    const scope = scopeFor(principal.grants, roles as StaffRole[]);
    if (scope === null) throw new ForbiddenException(FORBIDDEN);
    req.staff = { ...principal, scope };
    return true;
  }
}

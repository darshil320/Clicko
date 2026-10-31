import { randomUUID } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  InternalServerErrorException,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { clientIp } from '../../../common/http/client-ip';
import type { AuditContext, StaffRequest } from '../access/staff-context';

const AUDIT_ACTION_KEY = 'clickco:audit-action';
const MUTATING: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const USER_AGENT_MAX = 512;

const header = (req: StaffRequest, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
};

/** `::ffff:10.1.2.3` → `10.1.2.3`; anything that is not an IP is dropped (the column is inet). */
export const normaliseIp = (raw: string | undefined): string | null => clientIp(raw);

/**
 * ADR-0025 D4. On every /admin controller: refuses to run a mutating handler that is not
 * @Audited (fail closed — a test also enumerates the routes), and hands the request context
 * (actor, action, IP, user agent, a server-made request id) to the handler, which records the
 * audit row inside its own transaction through AuditService. Every answer is `no-store`.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<StaffRequest>();
    const action: unknown = Reflect.getMetadata(AUDIT_ACTION_KEY, context.getHandler());
    if (MUTATING.has(req.method) && typeof action !== 'string') {
      throw new InternalServerErrorException({
        code: 'AUDIT_MISSING',
        message: 'This action is not audited and was refused',
      });
    }
    // Always ours: a client-chosen id could muddle forensic correlation in the audit log.
    const requestId = randomUUID();
    const res = http.getResponse<{ setHeader(name: string, value: string): unknown }>();
    res.setHeader('x-request-id', requestId);
    // Booking pages, TOTP secrets and temporary passwords must never sit in a cache.
    res.setHeader('cache-control', 'no-store');
    const audit: AuditContext = {
      actor: req.staff ? { kind: 'STAFF', id: req.staff.id, email: req.staff.email } : null,
      action: typeof action === 'string' ? action : null,
      ip: normaliseIp(req.ip),
      userAgent: header(req, 'user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
      requestId,
    };
    req.audit = audit;
    return next.handle();
  }
}

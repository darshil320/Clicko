import { createHash } from 'node:crypto';
import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { from, mergeMap, type Observable, of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CLOCK, type Clock } from '../clock';
import { IdempotencyStore } from './idempotency.store';

/** Set by @Idempotent({ ttlMs }) (string literal: importing the decorator would be a cycle). */
const TTL_METADATA = 'clickco:idempotency-ttl-ms';

const HEADER = 'idempotency-key';
const KEY_FORMAT = /^[A-Za-z0-9._:-]{8,128}$/;

interface IdempotentRequest {
  readonly method: string;
  readonly path: string;
  readonly route?: { readonly path?: string };
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly subject?: { readonly kind: string; readonly id: string };
}

interface IdempotentResponse {
  statusCode: number;
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/** sha256 over method, concrete path and JSON body: any change makes it a different request. */
export function requestHash(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

function readKey(raw: string | string[] | undefined): string {
  if (raw === undefined || raw === '') {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'This request needs an Idempotency-Key header',
    });
  }
  if (typeof raw !== 'string' || !KEY_FORMAT.test(raw)) {
    throw new BadRequestException({
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: 'Idempotency-Key must be 8–128 characters of A–Z, a–z, 0–9, . _ : -',
    });
  }
  return raw;
}

/**
 * G-34 / DOMAIN §5 rule 9. Applied with @Idempotent(), after the auth guard. Same key + same
 * request replays the stored response; a different request under the key is 422; a concurrent
 * duplicate is 409. A failed request releases its key (its transaction rolled back, so a retry
 * is safe). Known limit: the key is completed after the business transaction commits, so a
 * crash in between leaves a stale claim that is recovered after IDEMPOTENCY_POLICY.staleLockMs.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IdempotencyStore) private readonly store: IdempotencyStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<IdempotentRequest>();
    const res = http.getResponse<IdempotentResponse>();
    // Scoped by subject kind and id: a USER and a PHOTOGRAPHER can never share a key.
    const owner = req.subject ? `${req.subject.kind}:${req.subject.id}` : 'anonymous';
    const key = `${owner}:${readKey(req.headers[HEADER])}`;
    const ttlMs: unknown = Reflect.getMetadata(TTL_METADATA, context.getHandler());
    const claim = await this.store.claim({
      key,
      scope: `${req.method} ${req.route?.path ?? req.path}`,
      requestHash: requestHash(req.method, req.path, req.body),
      now: this.clock(),
      ...(typeof ttlMs === 'number' ? { ttlMs } : {}),
    });

    if (claim.kind === 'REPLAY') {
      res.status(claim.status);
      res.setHeader('Idempotent-Replayed', 'true');
      return of(claim.body);
    }
    if (claim.kind === 'MISMATCH') {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This Idempotency-Key was already used for a different request',
      });
    }
    if (claim.kind === 'IN_FLIGHT') {
      throw new ConflictException({
        code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        message: 'The same request is still being processed — retry shortly',
      });
    }

    return next.handle().pipe(
      catchError((error: unknown) =>
        from(this.store.release(key)).pipe(mergeMap(() => throwError(() => error))),
      ),
      mergeMap(async (body: unknown) => {
        await this.store.complete(key, res.statusCode, body, this.clock());
        return body;
      }),
    );
  }
}

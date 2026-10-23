import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/** Handler metadata: how long a key (and its stored response) lives for this route. */
export const IDEMPOTENCY_TTL_MS = 'clickco:idempotency-ttl-ms';

export interface IdempotentOptions {
  /** Defaults to IDEMPOTENCY_POLICY.ttlMs (24 h). */
  readonly ttlMs?: number;
}

/**
 * Every money-mutating endpoint carries this (DOMAIN §5 rule 9). The hosting module must import
 * IdempotencyModule. Put it on routes behind AuthGuard: keys are scoped per signed-in subject.
 */
export const Idempotent = (options: IdempotentOptions = {}): MethodDecorator & ClassDecorator =>
  applyDecorators(
    UseInterceptors(IdempotencyInterceptor),
    ...(options.ttlMs === undefined ? [] : [SetMetadata(IDEMPOTENCY_TTL_MS, options.ttlMs)]),
  );

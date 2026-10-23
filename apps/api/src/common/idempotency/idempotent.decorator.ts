import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Every money-mutating endpoint carries this (DOMAIN §5 rule 9). The hosting module must import
 * IdempotencyModule. Put it on routes behind AuthGuard: keys are scoped per signed-in subject.
 */
export const Idempotent = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseInterceptors(IdempotencyInterceptor));

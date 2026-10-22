import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Subject } from '../../modules/auth/token.service';

/** The authenticated subject placed on the request by AuthGuard. */
export const CurrentSubject = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Subject => ctx.switchToHttp().getRequest().subject,
);

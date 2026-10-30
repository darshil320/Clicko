import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../modules/auth/token.service';

/** Requires `Authorization: Bearer <access token>`; attaches the verified subject to the request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: unknown = req.headers?.authorization;
    const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    if (!match?.[1]) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in required' });
    }
    const { subject, issuedAt } = await this.tokens.verifyAccessClaims(match[1]);
    req.subject = subject;
    // When the access token was issued: staff sessions can be ended before it expires.
    req.accessIssuedAt = issuedAt;
    return true;
  }
}

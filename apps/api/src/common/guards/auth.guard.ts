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
    req.subject = await this.tokens.verifyAccess(match[1]);
    return true;
  }
}

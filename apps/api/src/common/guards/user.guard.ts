import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Subject } from '../../modules/auth/token.service';
import { UsersService } from '../../modules/users/users.service';
import { AuthGuard } from './auth.guard';

/**
 * Client routes (security audit L1): a valid session (AuthGuard) whose subject is a USER who is
 * not blocked — a blocked client's 15-minute access token stops working at once, as ProGuard
 * does for a paused photographer. Mirrors ProGuard; provided app-wide by UserGuardModule.
 */
@Injectable()
export class UserGuard implements CanActivate {
  constructor(
    @Inject(AuthGuard) private readonly auth: AuthGuard,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.auth.canActivate(context);
    const subject: Subject | undefined = context.switchToHttp().getRequest().subject;
    if (subject?.kind !== 'USER') {
      throw new ForbiddenException({
        code: 'CLIENTS_ONLY',
        message: 'Only client accounts can use this',
      });
    }
    const user = await this.users.findById(subject.id);
    if (!user || user.isBlocked) {
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'This account is blocked' });
    }
    return true;
  }
}

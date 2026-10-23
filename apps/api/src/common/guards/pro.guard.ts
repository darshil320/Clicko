import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Subject } from '../../modules/auth/token.service';
import { PhotographersService } from '../../modules/photographers/photographers.service';
import { AuthGuard } from './auth.guard';

/**
 * /pro/* routes: a valid session (AuthGuard) whose subject is a PHOTOGRAPHER who is still ACTIVE —
 * a paused or suspended photographer's 15-minute access token stops working at once.
 */
@Injectable()
export class ProGuard implements CanActivate {
  constructor(
    @Inject(AuthGuard) private readonly auth: AuthGuard,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.auth.canActivate(context);
    const subject: Subject | undefined = context.switchToHttp().getRequest().subject;
    if (subject?.kind !== 'PHOTOGRAPHER') {
      throw new ForbiddenException({
        code: 'PHOTOGRAPHERS_ONLY',
        message: 'Only photographer accounts can use this',
      });
    }
    if (!(await this.photographers.findActiveById(subject.id))) {
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account is not active — contact Clickco support',
      });
    }
    return true;
  }
}

import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { AuthGuard } from '../../common/guards/auth.guard';
import type { Subject } from '../auth/token.service';
import { UsersService } from './users.service';

@Controller('me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  async me(@CurrentSubject() subject: Subject) {
    const user = subject.kind === 'USER' ? await this.users.findById(subject.id) : null;
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    if (user.isBlocked)
      throw new ForbiddenException({ code: 'ACCOUNT_BLOCKED', message: 'This account is blocked' });
    return ok({ id: user.id, phone: user.phone, fullName: user.fullName });
  }
}

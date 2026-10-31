import { Controller, Get, Inject, NotFoundException, UseGuards } from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import type { Subject } from '../auth/token.service';
import { UsersService } from './users.service';

@Controller('me')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get()
  async me(@CurrentSubject() subject: Subject) {
    // UserGuard has checked the kind and that the account exists and is not blocked.
    const user = await this.users.findById(subject.id);
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    return ok({ id: user.id, phone: user.phone, fullName: user.fullName });
  }
}

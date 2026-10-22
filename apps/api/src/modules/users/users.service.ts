import { Inject, Injectable } from '@nestjs/common';
import { type UserRecord, UsersRepository } from './repositories/users.repository';

/** The only way other modules read or create users (they never query the users table). */
@Injectable()
export class UsersService {
  constructor(@Inject(UsersRepository) private readonly repo: UsersRepository) {}

  findOrCreateByPhone(phone: string): Promise<{ user: UserRecord; isNew: boolean }> {
    return this.repo.findOrCreateByPhone(phone);
  }

  findById(id: string): Promise<UserRecord | null> {
    return this.repo.findById(id);
  }
}

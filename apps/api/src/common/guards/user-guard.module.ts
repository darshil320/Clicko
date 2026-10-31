import { Global, Module } from '@nestjs/common';
import { TokenModule } from '../../modules/auth/token.module';
import { UsersModule } from '../../modules/users/users.module';
import { UserGuard } from './user.guard';

/**
 * Makes `@UseGuards(UserGuard)` resolvable in every module (checkout, delivery, onsite, users)
 * without each importing UsersModule. Nest builds a controller-level guard in the controller's
 * own module, so the guard's dependencies (AuthGuard from TokenModule, UsersService) are
 * re-exported globally with it.
 */
@Global()
@Module({
  imports: [TokenModule, UsersModule],
  providers: [UserGuard],
  exports: [UserGuard, TokenModule, UsersModule],
})
export class UserGuardModule {}

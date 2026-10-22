import { Module } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ENV, type Env } from '../../config/env';
import {
  PgRefreshTokenRepository,
  REFRESH_TOKEN_REPOSITORY,
} from './repositories/refresh-token.repository';
import { JWT_SECRET, TokenService } from './token.service';

/** Sessions + the guard. Separate from AuthModule so any module can protect routes without a cycle. */
@Module({
  providers: [
    { provide: JWT_SECRET, inject: [ENV], useFactory: (env: Env) => env.JWT_ACCESS_SECRET },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PgRefreshTokenRepository },
    TokenService,
    AuthGuard,
  ],
  exports: [TokenService, AuthGuard],
})
export class TokenModule {}

import { Module } from '@nestjs/common';
import { PhotographersService } from './photographers.service';
import { PhotographersRepository } from './repositories/photographers.repository';

/** No controllers yet: the Pro app reaches photographers through auth and dispatch. */
@Module({
  providers: [PhotographersRepository, PhotographersService],
  exports: [PhotographersService],
})
export class PhotographersModule {}

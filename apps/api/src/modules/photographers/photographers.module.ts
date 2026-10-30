import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module';
import { PhotographerDirectoryService } from './directory.service';
import { KycService } from './kyc.service';
import { OnboardingService } from './onboarding.service';
import { PhotographersService } from './photographers.service';
import { DirectoryRepository } from './repositories/directory.repository';
import { KycRepository } from './repositories/kyc.repository';
import { OnboardingRepository } from './repositories/onboarding.repository';
import { PhotographersRepository } from './repositories/photographers.repository';

/**
 * No controllers: the Pro app reaches photographers through auth and dispatch; staff through the
 * admin desks (ADR-0026 D5: onboarding, KYC, directory, penalty waivers — StoragePort for the
 * 5-minute KYC document links).
 */
@Module({
  imports: [StorageModule],
  providers: [
    PhotographersRepository,
    PhotographersService,
    OnboardingRepository,
    KycRepository,
    DirectoryRepository,
    OnboardingService,
    KycService,
    PhotographerDirectoryService,
  ],
  exports: [PhotographersService, OnboardingService, KycService, PhotographerDirectoryService],
})
export class PhotographersModule {}

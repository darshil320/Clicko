import { Module } from '@nestjs/common';
import { StorageModule } from '../../infra/storage/storage.module';
import { ReviewRatingsModule } from '../reviews/review-ratings.module';
import { PhotographerDirectoryService } from './directory.service';
import { KycService } from './kyc.service';
import { KycRetentionService } from './kyc-retention.service';
import { OnboardingService } from './onboarding.service';
import { PhotographersService } from './photographers.service';
import { RatingSubscribers } from './rating.subscribers';
import { DirectoryRepository } from './repositories/directory.repository';
import { KycRepository } from './repositories/kyc.repository';
import { MetricsRepository } from './repositories/metrics.repository';
import { OnboardingRepository } from './repositories/onboarding.repository';
import { PhotographersRepository } from './repositories/photographers.repository';

/**
 * No controllers: the Pro app reaches photographers through auth and dispatch; staff through the
 * admin desks (ADR-0026 D5: onboarding, KYC, directory, penalty waivers — StoragePort for the
 * 5-minute KYC document links). photographer_metrics' rating follows the `review.*` outbox events
 * (ADR-0027 D4), read through the reviews module's ReviewRatings. KYC documents are purged
 * (DPDP) once the relationship ends: KycRetentionService, swept by `supply.kyc-purge`.
 */
@Module({
  imports: [StorageModule, ReviewRatingsModule],
  providers: [
    PhotographersRepository,
    PhotographersService,
    OnboardingRepository,
    KycRepository,
    DirectoryRepository,
    OnboardingService,
    KycService,
    KycRetentionService,
    PhotographerDirectoryService,
    MetricsRepository,
    RatingSubscribers,
  ],
  exports: [
    PhotographersService,
    OnboardingService,
    KycService,
    KycRetentionService,
    PhotographerDirectoryService,
  ],
})
export class PhotographersModule {}

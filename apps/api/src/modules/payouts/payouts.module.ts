import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { LedgerService } from '../payments/ledger/ledger.service';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { SlaModule } from '../sla/sla.module';
import { PhotographerReadsAdapter } from './adapters/photographer-reads.adapter';
import { SlaBreachesAdapter } from './adapters/sla-breaches.adapter';
import { BANK_ACCOUNT_CIPHER, BankAccountCipher, bankKeyringFrom } from './bank-account-cipher';
import { PayoutAssessmentService } from './payout-assessment.service';
import { PayoutBatchesService } from './payout-batches.service';
import { PayoutFilesService } from './payout-files.service';
import { PayoutLedger } from './payout-ledger';
import { PayoutReadsService } from './payout-reads.service';
import { PayoutsService } from './payouts.service';
import { PayoutsSubscribers } from './payouts.subscribers';
import { BREACH_DEDUCTIONS, PAYEE_DIRECTORY, PENALTY_DEDUCTIONS } from './ports';
import { BatchesRepository } from './repositories/batches.repository';
import {
  DeductionsRepository,
  VendorInvoicesRepository,
} from './repositories/deductions.repository';
import { PayoutsRepository } from './repositories/payouts.repository';

/**
 * Photographer payouts, batches, TDS and the bank file (ADR-0026 D3, doc 02 `modules/payouts`).
 * Owns payouts, payout_batches, payout_deductions and vendor_invoices. Reads bookings, dispatch,
 * SLA and serviceability through their services; photographers through PAYEE_DIRECTORY /
 * PENALTY_DEDUCTIONS (interim adapter, see ./adapters). Ledger postings go through the payments
 * module's LedgerService (stateless; provided here, the payments module does not export it).
 * The staff endpoints live in AdminPayoutsController, declared by the AdminModule.
 */
@Module({
  imports: [BookingsModule, DispatchModule, SlaModule, ServiceabilityModule],
  providers: [
    PayoutsRepository,
    BatchesRepository,
    DeductionsRepository,
    VendorInvoicesRepository,
    LedgerService,
    PayoutLedger,
    PhotographerReadsAdapter,
    { provide: PAYEE_DIRECTORY, useExisting: PhotographerReadsAdapter },
    { provide: PENALTY_DEDUCTIONS, useExisting: PhotographerReadsAdapter },
    { provide: BREACH_DEDUCTIONS, useClass: SlaBreachesAdapter },
    {
      provide: BANK_ACCOUNT_CIPHER,
      inject: [ENV],
      // Audit M4: its own BANK_ACCOUNT_KEY (versioned keyring); never STAFF_TOTP_KEY when deployed.
      useFactory: (env: Env) => new BankAccountCipher(bankKeyringFrom(env)),
    },
    PayoutAssessmentService,
    PayoutsService,
    PayoutReadsService,
    PayoutBatchesService,
    PayoutFilesService,
    PayoutsSubscribers,
  ],
  exports: [PayoutsService, PayoutReadsService, PayoutBatchesService, PayoutFilesService],
})
export class PayoutsModule {}

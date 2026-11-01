import { Module } from '@nestjs/common';
import { ClientBlocksReader } from './client-blocks.reader';
import { ReportsReader } from './reports.reader';

/**
 * The safety module's read-only views for other modules, with no imports of their own: dispatch
 * (blocks) and reviews (open reports) import this, not SafetyModule — which itself depends on
 * both of them — so there is no import cycle.
 */
@Module({
  providers: [ClientBlocksReader, ReportsReader],
  exports: [ClientBlocksReader, ReportsReader],
})
export class SafetyReadersModule {}

import { Logger } from '@nestjs/common';
import { maskPhone } from '../../notifications/masking';
import { CALLS_CONFIG } from '../calls.config';
import type { CallReceipt, CallsPort, ConnectCallRequest } from '../calls.port';

const MAX_REMEMBERED = 100;

/**
 * DEVELOPMENT AND TEST ONLY: records the bridge that would be placed and logs masked numbers.
 * Tests read `placed` (and its providerCallId) to drive the status webhook.
 */
export class ConsoleCallsAdapter implements CallsPort {
  readonly provider = 'console-calls';
  readonly virtualNumber = CALLS_CONFIG.consoleVirtualNumber;
  private readonly logger = new Logger('console-calls');
  private log: readonly (ConnectCallRequest & { readonly providerCallId: string })[] = [];
  private seq = 0;

  get placed(): readonly (ConnectCallRequest & { readonly providerCallId: string })[] {
    return this.log;
  }

  async connect(request: ConnectCallRequest): Promise<CallReceipt> {
    this.seq += 1;
    const providerCallId = `console-call-${this.seq}`;
    this.logger.log(
      `[dev only] masked call ${maskPhone(request.from)} → ${maskPhone(request.to)} via ${this.virtualNumber}`,
    );
    this.log = [...this.log, { ...request, providerCallId }].slice(-MAX_REMEMBERED);
    return { provider: this.provider, providerCallId };
  }
}

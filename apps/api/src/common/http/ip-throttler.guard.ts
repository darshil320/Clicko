import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ipBucket } from './client-ip';

/**
 * The global per-IP backstop, keyed by the shared IP bucket (audit H1): IPv4 clients per address
 * (never all in one `::ffff:` /64), IPv6 per /64, every unusable address in one bucket.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return ipBucket(typeof req.ip === 'string' ? req.ip : null);
  }
}

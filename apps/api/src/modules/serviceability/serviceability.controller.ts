import { JoinWaitlistBody, Pincode } from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ServiceabilityService } from './serviceability.service';

/** Public: the app checks serviceability before sign-in. */
@Controller()
export class ServiceabilityController {
  constructor(@Inject(ServiceabilityService) private readonly service: ServiceabilityService) {}

  @Get('serviceability/:pincode')
  async check(@Param('pincode', new ZodValidationPipe(Pincode)) pincode: string) {
    return ok(await this.service.check(pincode));
  }

  @Post('waitlist')
  @HttpCode(200)
  async join(@Body(new ZodValidationPipe(JoinWaitlistBody)) body: JoinWaitlistBody) {
    return ok(await this.service.join(body));
  }
}

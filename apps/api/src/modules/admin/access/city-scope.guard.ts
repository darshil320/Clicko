import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { scopeCovers } from './roles';
import {
  CITY_RESOLVER,
  type CityResolverPort,
  type ScopedEntity,
  type StaffRequest,
} from './staff-context';

const CITY_SCOPED_KEY = 'clickco:city-scoped';

const NOT_FOUND: Readonly<Record<ScopedEntity, { code: string; message: string }>> = {
  booking: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' },
  assignment: { code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' },
  breach: { code: 'BREACH_NOT_FOUND', message: 'Breach not found' },
};

/**
 * @CityScoped(entity, param) (ADR-0025 D3): runs after StaffGuard. The entity's booking city
 * must be in the caller's scope for this route. Another city's entity answers exactly like a
 * missing one (404), so ids from other cities cannot be probed.
 */
@Injectable()
export class CityScopeGuard implements CanActivate {
  constructor(@Inject(CITY_RESOLVER) private readonly resolver: CityResolverPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = Reflect.getMetadata(CITY_SCOPED_KEY, context.getHandler()) as
      | { entity: ScopedEntity; param: string }
      | undefined;
    if (!spec) throw new Error('CityScopeGuard without @CityScoped metadata');
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (!req.staff) throw new Error('CityScopeGuard must run after StaffGuard');
    const id = req.params[spec.param];
    const cityId = id ? await this.resolver.cityOf(spec.entity, id) : null;
    if (cityId === null || !scopeCovers(req.staff.scope, cityId)) {
      throw new NotFoundException(NOT_FOUND[spec.entity]);
    }
    return true;
  }
}

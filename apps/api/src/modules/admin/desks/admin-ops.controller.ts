import {
  AdminAlertPage,
  AdminAttributeBreachBody,
  AdminBreachDecisionResponse,
  AdminBreachPage,
  AdminBreachQuery,
  AdminConfirmIncidentBody,
  AdminConfirmIncidentResponse,
  AdminIncidentPage,
  AdminListQuery,
  AdminQaDecisionBody,
  AdminQaDecisionResponse,
  AdminQaPage,
  AdminWaiveBreachBody,
  Uuid,
} from '@clickco/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditCtx, Audited, CityScoped, CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { AlertFeedService } from './alert-feed.service';
import { BreachDeskService } from './breach-desk.service';
import { IncidentDeskService } from './incident-desk.service';
import { AdminQueryPipe, type BreachQuery, type ListQuery } from './paging';
import { QaDeskService } from './qa-desk.service';

const uuid = new ZodValidationPipe(Uuid);

/**
 * The QA desk, incident confirmations, the SLA breach board and the alert feed (ADR-0025 D5).
 * Every decision is role + city checked, @Audited (the row commits with the change) and
 * idempotent under the panel's Idempotency-Key, so a retried click never decides twice.
 */
@Controller('admin')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminOpsController {
  constructor(
    @Inject(QaDeskService) private readonly qa: QaDeskService,
    @Inject(IncidentDeskService) private readonly incidents: IncidentDeskService,
    @Inject(BreachDeskService) private readonly breaches: BreachDeskService,
    @Inject(AlertFeedService) private readonly alerts: AlertFeedService,
  ) {}

  @Get('qa')
  @Roles(...DESK_ROLES.qa)
  async qaQueue(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminListQuery)) q: ListQuery,
  ) {
    return respond(AdminQaPage, await this.qa.queue(caller, q));
  }

  @Post('qa/:bookingId')
  @HttpCode(200)
  @Roles(...DESK_ROLES.qa)
  @CityScoped('booking', 'bookingId')
  @Audited('qa.decide')
  @Idempotent()
  async qaDecide(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('bookingId', uuid) bookingId: string,
    @Body(new ZodValidationPipe(AdminQaDecisionBody)) body: AdminQaDecisionBody,
  ) {
    return respond(AdminQaDecisionResponse, await this.qa.decide(caller, ctx, bookingId, body));
  }

  @Get('incidents')
  @Roles(...DESK_ROLES.incidents)
  async incidentList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminListQuery)) q: ListQuery,
  ) {
    return respond(AdminIncidentPage, await this.incidents.list(caller, q));
  }

  @Post('assignments/:assignmentId/confirm-incident')
  @HttpCode(200)
  @Roles(...DESK_ROLES.incidents)
  @CityScoped('assignment', 'assignmentId')
  @Audited('incident.confirm')
  @Idempotent()
  async confirmIncident(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('assignmentId', uuid) assignmentId: string,
    @Body(new ZodValidationPipe(AdminConfirmIncidentBody)) body: AdminConfirmIncidentBody,
  ) {
    return respond(
      AdminConfirmIncidentResponse,
      await this.incidents.confirm(caller, ctx, assignmentId, body),
    );
  }

  @Get('breaches')
  @Roles(...DESK_ROLES.breaches)
  async breachList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminBreachQuery)) q: BreachQuery,
  ) {
    return respond(AdminBreachPage, await this.breaches.list(caller, q));
  }

  @Post('breaches/:breachId/attribute')
  @HttpCode(200)
  @Roles(...DESK_ROLES.breaches)
  @CityScoped('breach', 'breachId')
  @Audited('breach.attribute')
  @Idempotent()
  async attribute(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('breachId', uuid) breachId: string,
    @Body(new ZodValidationPipe(AdminAttributeBreachBody)) body: AdminAttributeBreachBody,
  ) {
    return respond(
      AdminBreachDecisionResponse,
      await this.breaches.attribute(caller, ctx, breachId, body),
    );
  }

  @Post('breaches/:breachId/waive')
  @HttpCode(200)
  @Roles(...DESK_ROLES.breaches)
  @CityScoped('breach', 'breachId')
  @Audited('breach.waive')
  @Idempotent()
  async waive(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('breachId', uuid) breachId: string,
    @Body(new ZodValidationPipe(AdminWaiveBreachBody)) body: AdminWaiveBreachBody,
  ) {
    return respond(
      AdminBreachDecisionResponse,
      await this.breaches.waive(caller, ctx, breachId, body),
    );
  }

  @Get('alerts')
  @Roles(...DESK_ROLES.alerts)
  async alertFeed(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminListQuery)) q: ListQuery,
  ) {
    return respond(AdminAlertPage, await this.alerts.list(caller, q));
  }
}

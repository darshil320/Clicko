import {
  RegisterPushTokenBody,
  UnregisterPushTokenBody,
  UpdateNotificationPreferencesBody,
} from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { ProGuard } from '../../common/guards/pro.guard';
import { UserGuard } from '../../common/guards/user.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { NotificationSettingsService } from './notification-settings.service';
import type { AccountRef } from './notifications.types';

const RegisterPipe = new ZodValidationPipe(RegisterPushTokenBody);
const UnregisterPipe = new ZodValidationPipe(UnregisterPushTokenBody);
const PreferencesPipe = new ZodValidationPipe(UpdateNotificationPreferencesBody);

/** The same four routes for both apps; only the guard and the account kind differ. */
abstract class SettingsRoutes {
  protected abstract readonly kind: AccountRef['kind'];

  constructor(protected readonly settings: NotificationSettingsService) {}

  protected owner(s: Subject): AccountRef {
    return { kind: this.kind, id: s.id };
  }

  @Post('push-tokens')
  @HttpCode(200)
  async register(@CurrentSubject() s: Subject, @Body(RegisterPipe) body: RegisterPushTokenBody) {
    return ok(await this.settings.registerPushToken(this.owner(s), body));
  }

  @Post('push-tokens/unregister')
  @HttpCode(200)
  async unregister(
    @CurrentSubject() s: Subject,
    @Body(UnregisterPipe) body: UnregisterPushTokenBody,
  ) {
    return ok(await this.settings.unregisterPushToken(this.owner(s), body.token));
  }

  @Get('notification-preferences')
  async preferences(@CurrentSubject() s: Subject) {
    return ok(await this.settings.view(this.owner(s)));
  }

  @Post('notification-preferences')
  @HttpCode(200)
  async updatePreferences(
    @CurrentSubject() s: Subject,
    @Body(PreferencesPipe) body: UpdateNotificationPreferencesBody,
  ) {
    return ok(await this.settings.update(this.owner(s), body));
  }
}

/** Client app (ADR-0027 D2). UserGuard: USER sessions of accounts that are not blocked. */
@Controller('me')
@UseGuards(UserGuard)
export class ClientNotificationSettingsController extends SettingsRoutes {
  protected readonly kind = 'USER' as const;

  constructor(@Inject(NotificationSettingsService) settings: NotificationSettingsService) {
    super(settings);
  }
}

/** Pro app (ADR-0027 D2). ProGuard: PHOTOGRAPHER sessions of ACTIVE photographers. */
@Controller('pro')
@UseGuards(ProGuard)
export class ProNotificationSettingsController extends SettingsRoutes {
  protected readonly kind = 'PHOTOGRAPHER' as const;

  constructor(@Inject(NotificationSettingsService) settings: NotificationSettingsService) {
    super(settings);
  }
}

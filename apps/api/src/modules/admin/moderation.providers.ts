import type { Provider, Type } from '@nestjs/common';
import { SafetyModule } from '../safety/safety.module';
import { AdminModerationController } from './desks/admin-moderation.controller';
import { ModerationDeskService } from './desks/moderation-desk.service';

/**
 * The moderation desk's part of the AdminModule (ADR-0027 D4): reports of reviews, clients and
 * photographers, decided through the safety module. One spread each in admin.module.ts.
 */
export const MODERATION_IMPORTS: Type[] = [SafetyModule];

export const MODERATION_CONTROLLERS: Type[] = [AdminModerationController];

export const MODERATION_PROVIDERS: Provider[] = [ModerationDeskService];

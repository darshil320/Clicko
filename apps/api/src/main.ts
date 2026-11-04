import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';
import { configureHttpApp } from './http-app';
import { ERROR_REPORTER, type ErrorReporter } from './infra/observability/error-reporter';
import { installProcessErrorReporting } from './infra/observability/process-handlers';

async function bootstrap(): Promise<void> {
  // rawBody: payment webhooks are verified by an HMAC over the exact bytes received.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  installProcessErrorReporting(app.get<ErrorReporter>(ERROR_REPORTER), process, 'api');
  const env = app.get<Env>(ENV);
  configureHttpApp(app, env);
  await app.listen(env.PORT);
}

void bootstrap();

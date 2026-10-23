import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  // rawBody: payment webhooks are verified by an HMAC over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  // Exact hop count so req.ip is the client, not the load balancer (OTP per-IP limits depend on it).
  app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY_HOPS);
  if (env.CORS_ORIGINS.length > 0) app.enableCors({ origin: env.CORS_ORIGINS });
  await app.listen(env.PORT);
}

void bootstrap();

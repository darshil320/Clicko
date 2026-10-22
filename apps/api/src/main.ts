import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  // Exact hop count so req.ip is the client, not the load balancer (OTP per-IP limits depend on it).
  app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY_HOPS);
  if (env.CORS_ORIGINS.length > 0) app.enableCors({ origin: env.CORS_ORIGINS });
  await app.listen(env.PORT);
}

void bootstrap();

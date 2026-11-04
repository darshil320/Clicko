import { Global, Module } from '@nestjs/common';
import { ConsoleErrorReporter } from './console-error-reporter';
import { ERROR_REPORTER } from './error-reporter';

/**
 * ADR-0029 D3: the error reporter for the API and the media worker. Console adapter only until
 * @sentry/node is approved; the Sentry adapter will be chosen here by env (ERROR_REPORTER=sentry
 * + SENTRY_DSN, required when deployed), sending the same scrubbed `toErrorEvent` shape.
 */
@Global()
@Module({
  providers: [{ provide: ERROR_REPORTER, useFactory: () => new ConsoleErrorReporter() }],
  exports: [ERROR_REPORTER],
})
export class ObservabilityModule {}

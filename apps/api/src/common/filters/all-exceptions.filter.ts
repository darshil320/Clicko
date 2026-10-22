import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, Envelope } from '../envelope';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  503: 'UNAVAILABLE',
};

function toApiError(exception: HttpException): ApiError {
  const status = exception.getStatus();
  const body = exception.getResponse();
  if (typeof body === 'object' && body !== null && 'code' in body && 'message' in body) {
    const b = body as { code: string; message: string; details?: unknown };
    return {
      code: b.code,
      message: b.message,
      ...(b.details === undefined ? {} : { details: b.details }),
    };
  }
  return { code: DEFAULT_CODES[status] ?? 'ERROR', message: exception.message };
}

/** Every error leaves as the standard envelope. Unknown errors never expose internals. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      // Health (and anything else) may already send a full envelope.
      if (typeof body === 'object' && body !== null && 'success' in body) {
        res.status(exception.getStatus()).json(body);
        return;
      }
      res
        .status(exception.getStatus())
        .json({ success: false, data: null, error: toApiError(exception) });
      return;
    }

    this.logger.error('Unhandled error', exception instanceof Error ? exception.stack : exception);
    const envelope: Envelope<null> = {
      success: false,
      data: null,
      error: { code: 'INTERNAL', message: 'Something went wrong' },
    };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(envelope);
  }
}

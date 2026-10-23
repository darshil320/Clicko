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
  413: 'PAYLOAD_TOO_LARGE',
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

/** body-parser's client errors (http-errors with `expose`), mapped to a safe code and message. */
const PARSER_ERRORS: Readonly<Record<string, ApiError>> = {
  'entity.too.large': { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large' },
  'entity.parse.failed': { code: 'INVALID_JSON', message: 'The request body is not valid JSON' },
};

function clientParserError(exception: unknown): { status: number; error: ApiError } | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const e = exception as { status?: unknown; expose?: unknown; type?: unknown };
  if (e.expose !== true || typeof e.status !== 'number' || e.status < 400 || e.status > 499) {
    return null;
  }
  const known = typeof e.type === 'string' ? PARSER_ERRORS[e.type] : undefined;
  return {
    status: e.status,
    error: known ?? { code: DEFAULT_CODES[e.status] ?? 'BAD_REQUEST', message: 'Bad request' },
  };
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

    const parser = clientParserError(exception);
    if (parser) {
      res.status(parser.status).json({ success: false, data: null, error: parser.error });
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

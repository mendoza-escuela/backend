import {
  ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import {
  auditContext,
  markSecurityReason,
} from '../../modules/audit/audit-context';

/** El middleware registra estado, actor y correlación. Nunca se serializa el
 * error de un driver: puede incluir SQL, parámetros o credenciales. */
@Catch()
@Injectable()
export class SafeHttpExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      return super.catch(exception, host);
    }
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    markSecurityReason(
      exception instanceof HttpException
        ? 'HTTP_SERVICE_ERROR'
        : 'UNEXPECTED_SERVER_ERROR',
    );
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        message:
          'El servicio no pudo completar la solicitud. Intentá nuevamente.',
        requestId: auditContext.getStore()?.requestId ?? null,
      });
  }
}

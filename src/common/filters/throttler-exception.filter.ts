import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';

@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .json({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message:
          'Se realizaron demasiadas solicitudes en poco tiempo. Esperá unos segundos e intentá nuevamente.',
      });
  }
}

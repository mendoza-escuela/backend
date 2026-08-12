import { HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ThrottlerExceptionFilter } from './throttler-exception.filter';

describe('ThrottlerExceptionFilter', () => {
  it('devuelve un mensaje público en español', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };

    new ThrottlerExceptionFilter().catch(
      new ThrottlerException(),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message:
        'Se realizaron demasiadas solicitudes en poco tiempo. Esperá unos segundos e intentá nuevamente.',
    });
  });
});

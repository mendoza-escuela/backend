import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { parseFrontendOrigin } from '../../config/frontend-origins';

export const CSRF_PROTECTION_HEADER = 'x-csrf-protection';
export const CSRF_PROTECTION_HEADER_VALUE = '1';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protege las mutaciones que pueden autenticarse mediante la cookie JWT.
 *
 * Los navegadores no permiten agregar una cabecera personalizada desde un
 * formulario cross-site. Las solicitudes fetch cross-site que intenten usarla
 * requieren un preflight CORS y, además, su Origin se valida contra la misma
 * lista cerrada utilizada por CORS. Los clientes que usan exclusivamente un
 * Bearer token no están expuestos a CSRF porque el navegador no adjunta ese
 * secreto automáticamente.
 */
@Injectable()
export class CsrfProtectionGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(configService: ConfigService) {
    this.allowedOrigin = parseFrontendOrigin(
      configService.getOrThrow<string>('FRONTEND_URL'),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method.toUpperCase();

    if (
      SAFE_METHODS.has(method) ||
      this.usesBearerTokenWithoutAuthCookie(request)
    ) {
      return true;
    }

    if (
      request.header(CSRF_PROTECTION_HEADER) !== CSRF_PROTECTION_HEADER_VALUE
    ) {
      throw this.invalidRequest();
    }

    const origin = request.header('origin');
    if (origin && !this.isAllowedOrigin(origin)) {
      throw this.invalidRequest();
    }

    return true;
  }

  private usesBearerTokenWithoutAuthCookie(request: Request): boolean {
    const authorization = request.header('authorization');
    return Boolean(
      authorization?.startsWith('Bearer ') &&
      !this.hasCookie(request, 'access_token'),
    );
  }

  private hasCookie(request: Request, cookieName: string): boolean {
    return Boolean(
      request.headers.cookie
        ?.split(';')
        .map((cookie) => cookie.trim().split('=', 1)[0])
        .includes(cookieName),
    );
  }

  private isAllowedOrigin(origin: string): boolean {
    return origin === this.allowedOrigin;
  }

  private invalidRequest(): ForbiddenException {
    return new ForbiddenException(
      'No se pudo validar el origen de la solicitud. Actualizá la página e intentá nuevamente.',
    );
  }
}

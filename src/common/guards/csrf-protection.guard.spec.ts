import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CsrfProtectionGuard } from './csrf-protection.guard';

describe('CsrfProtectionGuard', () => {
  const guard = new CsrfProtectionGuard({
    getOrThrow: jest.fn().mockReturnValue('https://app.example.com'),
  } as unknown as ConfigService);

  it('permite métodos seguros sin cabecera adicional', () => {
    expect(guard.canActivate(contextFor('GET'))).toBe(true);
  });

  it('permite mutaciones con cabecera y origen confiable', () => {
    expect(
      guard.canActivate(
        contextFor('POST', {
          origin: 'https://app.example.com',
          'x-csrf-protection': '1',
        }),
      ),
    ).toBe(true);
  });

  it('rechaza mutaciones sin la cabecera CSRF', () => {
    expect(() =>
      guard.canActivate(
        contextFor('POST', { origin: 'https://app.example.com' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rechaza un origen distinto aunque incluya la cabecera', () => {
    expect(() =>
      guard.canActivate(
        contextFor('DELETE', {
          origin: 'https://attacker.example',
          'x-csrf-protection': '1',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('permite clientes Bearer sin cookie porque no son vulnerables a CSRF', () => {
    expect(
      guard.canActivate(
        contextFor('PATCH', { authorization: 'Bearer api-token' }),
      ),
    ).toBe(true);
  });

  it('protege la cookie aunque también se envíe un Bearer token', () => {
    expect(() =>
      guard.canActivate(
        contextFor('PUT', {
          authorization: 'Bearer api-token',
          cookie: 'access_token=cookie-token',
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});

function contextFor(
  method: string,
  requestHeaders: Record<string, string> = {},
): ExecutionContext {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(requestHeaders).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
  const request = {
    method,
    headers: normalizedHeaders,
    header: (name: string) => normalizedHeaders[name.toLowerCase()],
  } as unknown as Request;

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

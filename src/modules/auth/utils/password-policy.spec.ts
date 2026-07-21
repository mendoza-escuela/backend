import { BadRequestException } from '@nestjs/common';
import { assertStrongPassword } from './password-policy';

describe('assertStrongPassword', () => {
  it('accepts a password that meets every rule', () => {
    expect(() => assertStrongPassword('ClaveSegura!2026')).not.toThrow();
  });

  it.each([
    'Corta!1',
    'SINMINUSCULA!2026',
    'sinmayuscula!2026',
    'SinNumero!!Clave',
    'SinSimbolo2026Clave',
  ])('rejects weak password %s', (password) => {
    expect(() => assertStrongPassword(password)).toThrow(BadRequestException);
  });
});

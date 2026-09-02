import { BadRequestException } from '@nestjs/common';

const PASSWORD_MIN_LENGTH = 12;

/** Valida la política única de contraseñas usada por alta, cambio y recuperación. */
export function assertStrongPassword(password: string): void {
  const isStrong =
    password.length >= PASSWORD_MIN_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);

  if (!isStrong) {
    throw new BadRequestException(
      'La contraseña debe tener al menos 12 caracteres, mayúscula, minúscula, número y símbolo.',
    );
  }
}

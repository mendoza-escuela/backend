import { spanishValidationException } from './spanish-validation-errors';

describe('spanishValidationException', () => {
  it('devuelve mensajes de validación en español sin exponer class-validator', () => {
    const exception = spanishValidationException([
      {
        property: 'versionCode',
        constraints: { isNotEmpty: 'versionCode should not be empty' },
        children: [],
      },
    ]);
    expect(exception.getResponse()).toMatchObject({
      error: 'Solicitud inválida',
      message: ['Completá el campo código de versión.'],
    });
  });
});

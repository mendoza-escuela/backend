import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

const fieldLabels: Record<string, string> = {
  campaignId: 'campaña',
  schoolId: 'escuela',
  surveyVersionId: 'versión del cuestionario',
  versionCode: 'código de versión',
  name: 'nombre',
  description: 'descripción',
  email: 'correo electrónico',
  password: 'contraseña',
  currentPassword: 'contraseña actual',
  newPassword: 'contraseña nueva',
  mentalHealthCriticalThreshold: 'umbral crítico de Salud Mental',
  mentalHealthMaxStars: 'máximo de estrellas con criticidad',
  starRanges: 'rangos de estrellas',
};

function fieldName(property: string) {
  if (/^\d+$/.test(property)) return `elemento ${Number(property) + 1}`;
  return (
    fieldLabels[property] ??
    property.replace(/([a-záéíóú])([A-Z])/g, '$1 $2').toLowerCase()
  );
}

function constraintMessage(constraint: string, field: string) {
  const label = fieldName(field);
  const messages: Record<string, string> = {
    whitelistValidation: `El campo ${label} no está permitido.`,
    isDefined: `El campo ${label} es obligatorio.`,
    isNotEmpty: `Completá el campo ${label}.`,
    isString: `El campo ${label} debe ser un texto.`,
    isNumber: `El campo ${label} debe ser un número válido.`,
    isInt: `El campo ${label} debe ser un número entero.`,
    isBoolean: `El campo ${label} debe ser verdadero o falso.`,
    isEmail: `Ingresá un correo electrónico válido.`,
    isUuid: `El identificador de ${label} no es válido.`,
    isEnum: `Seleccioná un valor válido para ${label}.`,
    isDateString: `Ingresá una fecha válida para ${label}.`,
    isObject: `El campo ${label} debe tener un formato válido.`,
    isArray: `El campo ${label} debe ser una lista.`,
    arrayMinSize: `El campo ${label} no contiene suficientes elementos.`,
    arrayMaxSize: `El campo ${label} contiene demasiados elementos.`,
    minLength: `El campo ${label} es demasiado corto.`,
    maxLength: `El campo ${label} supera la longitud permitida.`,
    min: `El valor de ${label} es menor al permitido.`,
    max: `El valor de ${label} supera el máximo permitido.`,
    matches: `El formato de ${label} no es válido.`,
    validateNested: `Revisá los datos de ${label}.`,
  };
  return messages[constraint] ?? `Revisá el valor del campo ${label}.`;
}

function messagesFor(error: ValidationError): string[] {
  const own = Object.keys(error.constraints ?? {}).map((constraint) =>
    constraintMessage(constraint, error.property),
  );
  return [
    ...own,
    ...(error.children ?? []).flatMap((child) => messagesFor(child)),
  ];
}

export function spanishValidationException(errors: ValidationError[]) {
  const messages = [...new Set(errors.flatMap((error) => messagesFor(error)))];
  return new BadRequestException({
    statusCode: 400,
    error: 'Solicitud inválida',
    message: messages.length
      ? messages
      : ['Revisá los datos ingresados e intentá nuevamente.'],
  });
}

import { BadRequestException } from '@nestjs/common';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(date: string) {
  if (!DATE_PATTERN.test(date))
    throw new BadRequestException('La fecha debe tener formato AAAA-MM-DD.');
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new BadRequestException('La fecha indicada no es válida.');
}

/** Convierte una fecha civil de Mendoza al inicio exacto del día en UTC. */
export function mendozaDayStart(date: string) {
  assertValidDate(date);
  return new Date(`${date}T00:00:00.000-03:00`);
}

/** Convierte una fecha civil de Mendoza a las 23:59:59.999 ART. */
export function mendozaDayEnd(date: string) {
  assertValidDate(date);
  return new Date(`${date}T23:59:59.999-03:00`);
}

export function mendozaDateString(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Mendoza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function mendozaYear(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en', {
      timeZone: 'America/Argentina/Mendoza',
      year: 'numeric',
    }).format(date),
  );
}

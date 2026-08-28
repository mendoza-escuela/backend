import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Filtro de archivos para las importaciones masivas (escuelas, usuarios,
 * cuestionarios).
 *
 * Antes se aceptaba cualquier archivo dentro del límite de tamaño y se confiaba
 * en que el parser fallara con lo que no fuera una planilla. Eso permitía
 * entregar contenido arbitrario al parser y gastar CPU y memoria en analizarlo
 * (hallazgo H-04). ASVS 5.0 V12.
 *
 * La comprobación es de superficie: tipo declarado más extensión. No sustituye
 * la validación de contenido que hace el propio parser, la acota.
 */

/** Tipos MIME que los navegadores y Excel envían para XLSX y CSV. */
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls y algunos .csv de Excel
  'text/csv',
  'application/csv',
  'text/plain', // varios navegadores envían esto para .csv
  'application/octet-stream', // cliente que no declara tipo; la extensión decide
]);

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

const MAX_FILENAME_LENGTH = 255;

export type MulterFileFilterCallback = (
  error: Error | null,
  acceptFile: boolean,
) => void;

export function importFileFilter(
  _request: Request,
  file: Express.Multer.File,
  callback: MulterFileFilterCallback,
): void {
  const originalName = file.originalname ?? '';

  if (originalName.length > MAX_FILENAME_LENGTH) {
    return callback(
      new BadRequestException(
        'El nombre del archivo es demasiado largo. Usá un nombre más corto.',
      ),
      false,
    );
  }

  // Aunque el archivo se procesa en memoria y nunca se escribe en disco, se
  // rechazan separadores de ruta y recorridos: el nombre puede terminar en un
  // mensaje de error, un log o una cabecera Content-Disposition.
  if (/[\\/]|\.\./.test(originalName)) {
    return callback(
      new BadRequestException('El nombre del archivo no es válido.'),
      false,
    );
  }

  const extensionIndex = originalName.lastIndexOf('.');
  const extension =
    extensionIndex >= 0 ? originalName.slice(extensionIndex).toLowerCase() : '';

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return callback(
      new BadRequestException(
        `Formato no admitido. Subí un archivo ${ALLOWED_EXTENSIONS.join(', ')}.`,
      ),
      false,
    );
  }

  const mimeType = (file.mimetype ?? '').toLowerCase().split(';')[0].trim();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return callback(
      new BadRequestException(
        'El tipo de archivo declarado no corresponde a una planilla.',
      ),
      false,
    );
  }

  return callback(null, true);
}

import { OmitType, PartialType } from '@nestjs/mapped-types';
import { SchoolFieldsDto } from './school-fields.dto';

/**
 * La baja y reactivación deben pasar siempre por el endpoint de estado para
 * que el cambio y la revocación de sesiones se ejecuten en una transacción.
 */
export class UpdateSchoolDto extends PartialType(
  OmitType(SchoolFieldsDto, ['isActive'] as const),
) {}

import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { RectifySchoolDto } from './rectify-school.dto';

const nullableTrim = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed || null;
};

const nullableEmail = ({ value }: { value: unknown }) => {
  const trimmed = nullableTrim({ value });
  return typeof trimmed === 'string' ? trimmed.toLowerCase() : trimmed;
};

/** Campos adicionales que sólo puede confirmar un administrador. */
export class AdminRectifySchoolDto extends RectifySchoolDto {
  @Transform(nullableTrim)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  schoolNumber?: string | null;

  @Transform(nullableTrim)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @Transform(nullableTrim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @Transform(nullableEmail)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;
}

import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { SchoolContactType } from '../entities/school-contact.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const optionalTrim = ({ value }: { value: unknown }) => {
  const normalized = trim({ value });
  return normalized === '' ? undefined : normalized;
};

abstract class SchoolContactIdentityDto {
  @IsEnum(SchoolContactType)
  type: SchoolContactType;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  firstName: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  lastName: string;
}

export class SchoolContactDto extends SchoolContactIdentityDto {
  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @Length(2, 160)
  position?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}

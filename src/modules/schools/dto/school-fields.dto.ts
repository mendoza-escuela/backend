import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { SchoolContactDto } from './school-contact.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const optionalTrim = ({ value }: { value: unknown }) => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};

export class SchoolFieldsDto {
  @Transform(trim)
  @IsString()
  @Length(3, 20)
  @Matches(/^[A-Za-z0-9.-]+$/, {
    message: 'El CUE contiene caracteres inválidos.',
  })
  cue: string;

  @Transform(trim)
  @IsString()
  @Length(2, 255)
  name: string;

  @Transform(trim)
  @IsString()
  @Length(2, 200)
  directorName: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  schoolNumber?: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  department: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  locality: string;

  @Transform(trim)
  @IsString()
  @Length(2, 255)
  address: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  educationLevel: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  managementType: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  scope: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  shift: string;

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

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  referentFirstName: string;

  @Transform(trim)
  @IsString()
  @Length(2, 100)
  referentLastName: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  referentEmail?: string;

  @Transform(optionalTrim)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  referentPhone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique((contact: SchoolContactDto) => contact.type, {
    message: 'Sólo puede existir un referente de cada tipo.',
  })
  @ValidateNested({ each: true })
  @Type(() => SchoolContactDto)
  contacts?: SchoolContactDto[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  enrollment: number;

  @IsOptional()
  @IsObject()
  characteristics?: Record<string, string | number | boolean | null>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

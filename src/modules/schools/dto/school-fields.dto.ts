import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS } from '../school-rectification.catalogs';
import { SchoolContactDto } from './school-contact.dto';
import { RectificationEducationLevelDto } from './rectify-school.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const optionalTrim = ({ value }: { value: unknown }) => {
  const trimmed = trim({ value });
  return trimmed === '' ? undefined : trimmed;
};
const nullableNumber = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) return null;
  return typeof value === 'string' ? Number(value) : value;
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
  @IsIn(
    OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.educationTypes.map(
      ({ label }) => label,
    ),
    { message: 'El tipo de educación no pertenece al catálogo oficial.' },
  )
  educationLevel: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @IsIn(
    OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.managementTypes.map(
      ({ label }) => label,
    ),
    { message: 'El sector/gestión no pertenece al catálogo oficial.' },
  )
  managementType: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @IsIn(
    OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.scopes.map(({ label }) => label),
    { message: 'El ámbito no pertenece al catálogo oficial.' },
  )
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

  @Transform(nullableNumber)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  enrollment?: number | null;

  @IsOptional()
  @IsObject()
  characteristics?: Record<string, string | number | boolean | null>;

  @IsOptional()
  @IsUUID()
  shiftCatalogId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RectificationEducationLevelDto)
  educationLevels?: RectificationEducationLevelDto[];

  @IsOptional()
  @IsBoolean()
  hasKiosk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  hasFoodService?: boolean | null;

  @IsOptional()
  @IsBoolean()
  isBoarding?: boolean | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

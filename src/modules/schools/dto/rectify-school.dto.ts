import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS,
  OfficialSchoolCharacteristics,
} from '../school-rectification.catalogs';
import { SchoolContactDto } from './school-contact.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
const nullableNumber = ({ value }: { value: unknown }) => {
  if (value === '' || value === null || value === undefined) return null;
  return typeof value === 'string' ? Number(value) : value;
};

export class RectificationEducationLevelDto {
  @IsUUID()
  levelId: string;

  @Transform(nullableNumber)
  @IsOptional()
  @IsInt({ message: 'La matrícula por nivel debe ser un número entero.' })
  @Min(0, { message: 'La matrícula por nivel no puede ser negativa.' })
  @Max(1_000_000, {
    message: 'La matrícula por nivel supera el máximo permitido.',
  })
  enrollment?: number | null;
}

export class RectificationCharacteristicsDto implements OfficialSchoolCharacteristics {
  @IsOptional()
  @IsBoolean()
  isMultigrade?: boolean | null;

  @IsOptional()
  @IsBoolean()
  isInterculturalBilingual?: boolean | null;
}

export class RectifySchoolDto {
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  name: string;

  @Transform(trim)
  @IsString()
  @Length(3, 20)
  @Matches(/^[A-Za-z0-9.-]+$/, {
    message: 'El CUE contiene caracteres inválidos.',
  })
  cue: string;

  @Transform(trim)
  @IsString()
  @Length(2, 200)
  directorName: string;

  @Transform(trim)
  @IsString()
  @Length(2, 255)
  address: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  locality: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  department: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @IsIn(
    OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.scopes.map(({ label }) => label),
    { message: 'El ámbito no pertenece al catálogo oficial.' },
  )
  scope: string;

  /**
   * La columna heredada educationLevel conserva el tipo de educación. Los
   * niveles ofrecidos por la escuela se registran en educationLevels.
   */
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
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @IsIn(
    OFFICIAL_SCHOOL_RECTIFICATION_CATALOGS.managementTypes.map(
      ({ label }) => label,
    ),
    { message: 'El sector/gestión no pertenece al catálogo oficial.' },
  )
  managementType?: string;

  /** Campo textual de jornada conservado sólo para clientes históricos. */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 120)
  shift?: string;

  @IsBoolean()
  hasKiosk: boolean;

  @IsBoolean()
  hasFoodService: boolean;

  @IsOptional()
  @IsBoolean()
  isBoarding?: boolean | null;

  @IsUUID()
  shiftCatalogId: string;

  @IsArray()
  @ArrayMinSize(1, {
    message: 'Debe seleccionarse al menos un nivel educativo.',
  })
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RectificationEducationLevelDto)
  educationLevels: RectificationEducationLevelDto[];

  @Transform(nullableNumber)
  @IsOptional()
  @IsInt({ message: 'La matrícula total debe ser un número entero.' })
  @Min(0, { message: 'La matrícula total no puede ser negativa.' })
  @Max(1_000_000, {
    message: 'La matrícula total supera el máximo permitido.',
  })
  enrollment?: number | null;

  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ArrayUnique((contact: SchoolContactDto) => contact.type, {
    message: 'Debe informarse un único referente de cada tipo.',
  })
  @ValidateNested({ each: true })
  @Type(() => SchoolContactDto)
  contacts?: SchoolContactDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RectificationCharacteristicsDto)
  characteristics?: RectificationCharacteristicsDto;
}

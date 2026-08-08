import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  scope: string;

  /**
   * Campos textuales heredados. Se mantienen opcionales para clientes
   * anteriores; los nuevos datos estructurados usan catálogos.
   */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 120)
  educationLevel?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 120)
  shift?: string;

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
  @IsUUID()
  shiftCatalogId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RectificationEducationLevelDto)
  educationLevels?: RectificationEducationLevelDto[];

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
}

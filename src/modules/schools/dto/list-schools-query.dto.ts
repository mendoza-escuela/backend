import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const optionalText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ListSchoolsQueryDto {
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  search?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  department?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  locality?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  educationLevel?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  managementType?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  scope?: string;
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  shift?: string;
  @IsOptional() @IsIn(['csv', 'xlsx']) format?: 'csv' | 'xlsx';

  @IsOptional()
  @Transform(({ value }): unknown => {
    const input = value as unknown;
    return input === true || input === 'true'
      ? true
      : input === false || input === 'false'
        ? false
        : input;
  })
  @IsBoolean()
  isActive?: boolean;

  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

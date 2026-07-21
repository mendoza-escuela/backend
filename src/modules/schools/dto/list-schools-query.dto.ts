import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListSchoolsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() locality?: string;
  @IsOptional() @IsString() educationLevel?: string;
  @IsOptional() @IsString() managementType?: string;
  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsString() shift?: string;
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

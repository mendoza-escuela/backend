import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

const optionalFilter = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;
const optionalBooleanFilter = ({ value }: { value: unknown }): unknown => {
  if (value === '' || value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
};

export class ListUsersQueryDto {
  @IsOptional()
  @Transform(optionalFilter)
  @IsString()
  @MaxLength(100)
  search?: string;
  @IsOptional() @Transform(optionalFilter) @IsEnum(UserRole) role?: UserRole;
  @IsOptional()
  @Transform(optionalBooleanFilter)
  @IsBoolean()
  isActive?: boolean;
  @IsOptional() @Transform(optionalFilter) @IsUUID() schoolId?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

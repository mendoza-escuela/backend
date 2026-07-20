import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) lastName?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() schoolId?:
    string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

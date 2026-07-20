import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

export class CreateUserDto {
  @IsString() @MinLength(2) @MaxLength(100) firstName: string;
  @IsString() @MinLength(2) @MaxLength(100) lastName: string;
  @IsEmail() @MaxLength(255) email: string;
  @IsEnum(UserRole) role: UserRole;
  @IsOptional() @IsUUID() schoolId?: string;
  @IsString() @MinLength(12) temporaryPassword: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

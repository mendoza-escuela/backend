import { IsBoolean } from 'class-validator';

export class SetUserStatusDto {
  @IsBoolean()
  isActive: boolean;
}

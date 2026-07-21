import { IsBoolean } from 'class-validator';

export class SetSchoolStatusDto {
  @IsBoolean()
  isActive: boolean;
}

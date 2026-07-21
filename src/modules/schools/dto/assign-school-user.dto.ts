import { IsOptional, IsUUID } from 'class-validator';

export class AssignSchoolUserDto {
  @IsOptional()
  @IsUUID()
  userId: string | null;
}

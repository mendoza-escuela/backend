import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

const optionalText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ParticipationDashboardQueryDto {
  @IsUUID()
  campaignId: string;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

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
}

export class ParticipationFilterOptionsQueryDto {
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
}

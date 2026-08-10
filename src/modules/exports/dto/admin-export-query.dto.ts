import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CampaignParticipationStatus } from '../../campaigns/dto/list-campaign-tracking-query.dto';

const optionalText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class AdminExportQueryDto {
  @IsUUID()
  campaignId: string;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @IsOptional()
  @IsIn(['csv', 'xlsx'])
  format: 'csv' | 'xlsx' = 'csv';

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

  @IsOptional()
  @IsEnum(CampaignParticipationStatus)
  status?: CampaignParticipationStatus;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(80)
  criticalArea?: string;
}

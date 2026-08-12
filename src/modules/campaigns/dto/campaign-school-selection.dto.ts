import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
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
import { CampaignSchoolAssignmentSource } from '../entities/campaign-school.entity';

const optionalText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CampaignSchoolFiltersDto {
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
  @Transform(({ value }): unknown =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : value,
  )
  @IsBoolean()
  isActive?: boolean;
}

export class ListCampaignSchoolsQueryDto extends CampaignSchoolFiltersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CampaignSchoolSelectionDto extends CampaignSchoolFiltersDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(2_500)
  @IsUUID('4', { each: true })
  schoolIds?: string[];

  @IsEnum(CampaignSchoolAssignmentSource)
  source: CampaignSchoolAssignmentSource;
}

export class RemoveCampaignSchoolDto {
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

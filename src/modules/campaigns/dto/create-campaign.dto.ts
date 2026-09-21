import {
  IsEnum,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Min,
  Max,
} from 'class-validator';
import { CampaignType } from '../entities/campaign-type.enum';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @IsEnum(CampaignType)
  type: CampaignType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  workflowCycle?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  sequenceOrder?: number | null;

  @IsUUID('4')
  surveyVersionId: string;

  @Matches(DATE_PATTERN, {
    message: 'La fecha de inicio debe tener formato AAAA-MM-DD.',
  })
  startDate: string;

  @Matches(DATE_PATTERN, {
    message: 'La fecha de cierre debe tener formato AAAA-MM-DD.',
  })
  endDate: string;
}

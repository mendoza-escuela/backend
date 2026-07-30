import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum CampaignParticipationStatus {
  NotStarted = 'not_started',
  Draft = 'draft',
  Submitted = 'submitted',
}

export enum CampaignTrackingSort {
  School = 'school',
  Status = 'status',
  LastSavedAt = 'last_saved_at',
  SubmittedAt = 'submitted_at',
}

export enum SortDirection {
  Asc = 'asc',
  Desc = 'desc',
}

const optionalText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ListCampaignTrackingQueryDto {
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Transform(optionalText)
  @IsEnum(CampaignParticipationStatus)
  status?: CampaignParticipationStatus;

  @IsOptional()
  @Transform(optionalText)
  @IsEnum(CampaignTrackingSort)
  sortBy: CampaignTrackingSort = CampaignTrackingSort.School;

  @IsOptional()
  @Transform(optionalText)
  @IsEnum(SortDirection)
  sortDirection: SortDirection = SortDirection.Asc;

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

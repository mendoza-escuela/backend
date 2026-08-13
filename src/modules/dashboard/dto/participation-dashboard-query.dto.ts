import { OmitType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  multiNumberValueQuery,
  multiValueQuery,
  multiValueQueryPreservingDuplicates,
} from '../../../common/transforms/multi-value-query.transform';
import { CampaignParticipationStatus } from '../../campaigns/dto/list-campaign-tracking-query.dto';
import { OfficialSurveyDimensionCode } from '../../surveys/templates/official-survey-dimensions.template';

const optionalText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class ParticipationDashboardQueryDto {
  @IsUUID()
  campaignId: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  schoolIds?: string[];

  /** @deprecated Usar `schoolIds`. */
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  departments?: string[];

  /** @deprecated Usar `departments`. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  department?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  localities?: string[];

  /** @deprecated Usar `localities`. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  locality?: string;

  /** Códigos estables de `education_level_catalogs`. */
  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  educationLevels?: string[];

  /** Tipo de educación almacenado en `schools.education_level`. */
  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  educationTypes?: string[];

  /** @deprecated El singular histórico representa Tipo de educación. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  educationLevel?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  managementTypes?: string[];

  /** @deprecated Usar `managementTypes`. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  managementType?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  scopes?: string[];

  /** @deprecated Usar `scopes`. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  scope?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  shifts?: string[];

  /** @deprecated Usar `shifts`. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  shift?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsEnum(CampaignParticipationStatus, { each: true })
  submissionStatuses?: CampaignParticipationStatus[];

  @IsOptional()
  @Transform(multiNumberValueQuery)
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(5, { each: true })
  stars?: number[];

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsEnum(OfficialSurveyDimensionCode, { each: true })
  criticalAreas?: OfficialSurveyDimensionCode[];
}

export class ParticipationFilterOptionsQueryDto {
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  departments?: string[];

  /** @deprecated Usar `departments`. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  department?: string;

  @IsOptional()
  @Transform(multiValueQuery)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  localities?: string[];

  /** @deprecated Usar `localities`. */
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(120)
  locality?: string;
}

export class CriticalAlertsDashboardQueryDto extends ParticipationDashboardQueryDto {
  @IsOptional()
  @IsEnum(OfficialSurveyDimensionCode)
  dimensionCode?: OfficialSurveyDimensionCode;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

/**
 * Filtros para comparar etapas conservando exactamente la misma segmentación
 * escolar de DASH-04. Cada etapa mantiene su propio universo y denominadores.
 */
export class ResultsComparisonDashboardQueryDto extends OmitType(
  ParticipationDashboardQueryDto,
  ['campaignId', 'submissionStatuses', 'stars', 'criticalAreas'] as const,
) {
  @Transform(multiValueQueryPreservingDuplicates)
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  campaignIds: string[];
}

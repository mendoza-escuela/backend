import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EvaluationStarRangeInputDto {
  @IsInt() @Min(1) @Max(5) stars: number;
  @IsNumber({ maxDecimalPlaces: 8 }) @Min(0) @Max(100) lowerBound: number;
  @IsNumber({ maxDecimalPlaces: 8 }) @Min(0) @Max(100) upperBound: number;
  @IsBoolean() lowerInclusive: boolean;
  @IsBoolean() upperInclusive: boolean;
  @IsInt() @Min(1) @Max(5) order: number;
}

export class CreateEvaluationConfigurationDto {
  @IsString() @IsNotEmpty() @MaxLength(50) versionCode: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  @Max(100)
  mentalHealthCriticalThreshold: number;
  @IsInt() @Min(1) @Max(5) mentalHealthMaxStars: number;
  @ValidateNested({ each: true })
  @Type(() => EvaluationStarRangeInputDto)
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  starRanges: EvaluationStarRangeInputDto[];
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateEvaluationConfigurationDto extends CreateEvaluationConfigurationDto {}

export class CloneEvaluationConfigurationDto {
  @IsString() @IsNotEmpty() @MaxLength(50) versionCode: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
}

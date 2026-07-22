import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';

const codePattern = /^[a-zA-Z0-9_-]+$/;

export class SurveyQuestionValidationDto {
  @IsOptional()
  @IsNumber()
  min?: number;

  @IsOptional()
  @IsNumber()
  max?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  minLength?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxLength?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxSelections?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  placeholder?: string;
}

export class SurveyOptionInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(codePattern, {
    message: 'El valor de opción tiene un formato inválido.',
  })
  value: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  helpText?: string | null;
}

export class SurveyQuestionInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(codePattern, { message: 'El código de pregunta es inválido.' })
  code: string;

  @IsEnum(SurveyQuestionType)
  type: SurveyQuestionType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  prompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  helpText?: string | null;

  @IsBoolean()
  required: boolean;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SurveyQuestionValidationDto)
  validation?: SurveyQuestionValidationDto;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SurveyOptionInputDto)
  options: SurveyOptionInputDto[];
}

export class SurveySectionInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(codePattern, { message: 'El código de sección es inválido.' })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionInputDto)
  questions: SurveyQuestionInputDto[];
}

export class SurveyDimensionInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(codePattern, { message: 'El código de dimensión es inválido.' })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SurveySectionInputDto)
  sections: SurveySectionInputDto[];
}

export class UpdateSurveyVersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  instructions?: string | null;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SurveyDimensionInputDto)
  dimensions: SurveyDimensionInputDto[];
}

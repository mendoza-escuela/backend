import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SurveyVersionTemplate } from '../entities/survey-version-template.enum';

export class CreateSurveyVersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  instructions?: string | null;

  @IsOptional()
  @IsUUID()
  sourceVersionId?: string;

  @IsOptional()
  @IsEnum(SurveyVersionTemplate)
  template?: SurveyVersionTemplate;
}

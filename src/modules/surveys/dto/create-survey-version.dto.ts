import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
}

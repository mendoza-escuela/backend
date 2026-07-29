import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportSurveyVersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  instructions?: string | null;
}

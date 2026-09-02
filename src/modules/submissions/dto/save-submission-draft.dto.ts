import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import type { SurveyAnswerValue } from '../entities/survey-answer.entity';

export class SubmissionAnswerDto {
  @IsUUID('4')
  questionId: string;

  @IsOptional()
  @IsUUID('4')
  optionId?: string | null;

  @IsOptional()
  value?: SurveyAnswerValue;
}

export class SaveSubmissionDraftDto {
  @IsInt()
  @Min(0)
  expectedRevision: number;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SubmissionAnswerDto)
  answers: SubmissionAnswerDto[];
}

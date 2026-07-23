import { IsUUID } from 'class-validator';

export class CompareSurveyVersionsQueryDto {
  @IsUUID()
  fromVersionId: string;

  @IsUUID()
  toVersionId: string;
}

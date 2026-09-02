import { IsInt, Min } from 'class-validator';

export class SubmitSubmissionDto {
  @IsInt()
  @Min(0)
  expectedRevision: number;
}

import { IsString, Matches, MaxLength } from 'class-validator';

export class SurveyCodeParamDto {
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'El código de cuestionario tiene un formato inválido.',
  })
  code: string;
}

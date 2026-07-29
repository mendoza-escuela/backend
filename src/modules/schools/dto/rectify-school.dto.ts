import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class RectifySchoolDto {
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  name: string;

  @Transform(trim)
  @IsString()
  @Length(3, 20)
  @Matches(/^[A-Za-z0-9.-]+$/, {
    message: 'El CUE contiene caracteres inválidos.',
  })
  cue: string;

  @Transform(trim)
  @IsString()
  @Length(2, 200)
  directorName: string;

  @Transform(trim)
  @IsString()
  @Length(2, 255)
  address: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  locality: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  scope: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  educationLevel: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  shift: string;
}

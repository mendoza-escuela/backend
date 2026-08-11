import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export class KioskApplicabilityAuditQueryDto {
  @IsOptional()
  @IsUUID()
  campaignId?: string;
}

export class KioskApplicabilityRepairTargetDto {
  @IsUUID()
  submissionId: string;
}

export class KioskApplicabilityDataRepairDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => KioskApplicabilityRepairTargetDto)
  targets: KioskApplicabilityRepairTargetDto[];

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewFingerprint: string;

  @IsBoolean()
  confirm: boolean;
}

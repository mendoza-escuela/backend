import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
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

export class KioskApplicabilityDataRepairPreviewDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  submissionIds: string[];
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

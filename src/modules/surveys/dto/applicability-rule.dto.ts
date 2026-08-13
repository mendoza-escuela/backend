import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ApplicabilityAction,
  ApplicabilityGroupOperator,
} from '../entities/survey-applicability-rule.entity';

export class ApplicabilityConditionDto {
  @IsString()
  feature: string;

  @IsString()
  operator: string;

  @IsDefined()
  expectedValue: string | number | boolean | string[];

  @IsInt()
  @Min(0)
  order: number;
}

export class WriteApplicabilityRuleDto {
  @IsEnum(ApplicabilityGroupOperator)
  groupOperator: ApplicabilityGroupOperator;

  @IsEnum(ApplicabilityAction)
  action: ApplicabilityAction;

  @IsEnum(ApplicabilityAction)
  defaultAction: ApplicabilityAction;

  @IsInt()
  @Min(0)
  order: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ApplicabilityConditionDto)
  conditions: ApplicabilityConditionDto[];
}

export class ReorderApplicabilityRulesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ruleIds: string[];
}

export class BulkCreateApplicabilityRuleDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  questionIds: string[];

  @ValidateNested()
  @Type(() => WriteApplicabilityRuleDto)
  rule: WriteApplicabilityRuleDto;
}

export class PreviewApplicabilityDto {
  @IsUUID()
  schoolId: string;
}

import { IsEnum } from 'class-validator';
import { CampaignStatus } from '../entities/campaign-status.enum';

export class SetCampaignStatusDto {
  @IsEnum(CampaignStatus)
  status: CampaignStatus;
}

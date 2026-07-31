import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { AdminSchoolResultDetailService } from '../services/admin-school-result-detail.service';

@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminSchoolResultDetailController {
  constructor(private readonly detailService: AdminSchoolResultDetailService) {}

  @Get(':campaignId/schools/:schoolId/result-detail')
  get(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
  ) {
    return this.detailService.get(campaignId, schoolId);
  }
}

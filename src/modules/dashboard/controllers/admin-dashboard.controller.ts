import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import {
  ParticipationDashboardQueryDto,
  ParticipationFilterOptionsQueryDto,
} from '../dto/participation-dashboard-query.dto';
import { ParticipationDashboardService } from '../services/participation-dashboard.service';

@Controller('admin/dashboard/participation')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminDashboardController {
  constructor(private readonly dashboard: ParticipationDashboardService) {}

  @Get()
  metrics(@Query() query: ParticipationDashboardQueryDto) {
    return this.dashboard.metrics(query);
  }

  @Get('filters')
  filters(@Query() query: ParticipationFilterOptionsQueryDto) {
    return this.dashboard.filterOptions(query);
  }
}

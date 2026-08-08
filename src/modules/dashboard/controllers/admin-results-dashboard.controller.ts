import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { ParticipationDashboardQueryDto } from '../dto/participation-dashboard-query.dto';
import { ResultsDashboardService } from '../services/results-dashboard.service';

@Controller('admin/dashboard/results')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminResultsDashboardController {
  constructor(private readonly dashboard: ResultsDashboardService) {}
  @Get() metrics(@Query() query: ParticipationDashboardQueryDto) {
    return this.dashboard.metrics(query);
  }
  @Get('star-distribution') distribution(
    @Query() query: ParticipationDashboardQueryDto,
  ) {
    return this.dashboard.distribution(query);
  }
}

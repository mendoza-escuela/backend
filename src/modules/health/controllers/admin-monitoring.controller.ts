import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { MonitoringService } from '../services/monitoring.service';

@Controller('admin/monitoring')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminMonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  status() {
    return this.monitoring.status();
  }
}

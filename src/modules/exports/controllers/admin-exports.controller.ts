import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { AdminExportQueryDto } from '../dto/admin-export-query.dto';
import { AdminExportsService } from '../services/admin-exports.service';

@Controller('admin/exports')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminExportsController {
  constructor(private readonly exportsService: AdminExportsService) {}

  @Get('results')
  results(
    @Query() query: AdminExportQueryDto,
    @Req() request: Request & { user: AuthenticatedUser },
    @Res() response: Response,
  ) {
    return this.exportsService.write('results', query, request.user, response);
  }

  @Get('answers')
  answers(
    @Query() query: AdminExportQueryDto,
    @Req() request: Request & { user: AuthenticatedUser },
    @Res() response: Response,
  ) {
    return this.exportsService.write('answers', query, request.user, response);
  }
}

import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { SchoolsService } from '../services/schools.service';
import { RectifySchoolDto } from '../dto/rectify-school.dto';

@Controller('schools')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.School)
export class SchoolPortalController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Get('me')
  findOwnSchool(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.schoolsService.findForUser(request.user.id);
  }

  @Get('me/rectification/catalogs')
  rectificationCatalogs(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.schoolsService.rectificationCatalogsForUser(request.user.id);
  }

  @Put('me/rectification')
  rectifyOwnSchool(
    @Req() request: Request & { user: AuthenticatedUser },
    @Body() dto: RectifySchoolDto,
  ) {
    return this.schoolsService.rectifyForUser(request.user, dto);
  }
}

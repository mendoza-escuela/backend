import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import {
  CloneEvaluationConfigurationDto,
  CreateEvaluationConfigurationDto,
  UpdateEvaluationConfigurationDto,
} from '../dto/evaluation-configuration.dto';
import { EvaluationConfigurationsService } from '../services/evaluation-configurations.service';

@Controller('admin/evaluation-configurations')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminEvaluationConfigurationsController {
  constructor(
    private readonly configurations: EvaluationConfigurationsService,
  ) {}
  @Get() list() {
    return this.configurations.list();
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.configurations.get(id);
  }
  @Post() create(
    @Body() dto: CreateEvaluationConfigurationDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.configurations.create(dto, request.user.id);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEvaluationConfigurationDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.configurations.update(id, dto, request.user.id);
  }
  @Post(':id/clone') clone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloneEvaluationConfigurationDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.configurations.clone(id, dto, request.user.id);
  }
  @Post(':id/validate') validate(@Param('id', ParseUUIDPipe) id: string) {
    return this.configurations.validate(id);
  }
  @Post(':id/activate') activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.configurations.activate(id, request.user.id);
  }
  @Post(':id/archive') archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.configurations.archive(id, request.user.id);
  }
}

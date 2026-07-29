import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { CreateCampaignDto } from '../dto/create-campaign.dto';
import { ListCampaignsQueryDto } from '../dto/list-campaigns-query.dto';
import { SetCampaignStatusDto } from '../dto/set-campaign-status.dto';
import { UpdateCampaignDto } from '../dto/update-campaign.dto';
import { CampaignsService } from '../services/campaigns.service';

@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminCampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(@Query() query: ListCampaignsQueryDto) {
    return this.campaignsService.list(query);
  }

  @Get('survey-versions')
  publishedVersionOptions() {
    return this.campaignsService.publishedVersionOptions();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaignsService.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateCampaignDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.campaignsService.create(dto, request.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.campaignsService.update(id, dto, request.user);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCampaignStatusDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.campaignsService.setStatus(id, dto.status, request.user);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.campaignsService.delete(id, request.user);
  }
}

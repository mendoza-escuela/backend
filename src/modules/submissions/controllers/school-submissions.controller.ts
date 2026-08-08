import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { SaveSubmissionDraftDto } from '../dto/save-submission-draft.dto';
import { SubmissionsService } from '../services/submissions.service';

@Controller('school/campaigns')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.School)
export class SchoolSubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get()
  available(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.submissionsService.availableCampaigns(request.user);
  }

  @Post(':campaignId/submission')
  start(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.submissionsService.startOrGet(campaignId, request.user);
  }

  @Get(':campaignId/submission')
  workspace(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.submissionsService.workspace(campaignId, request.user);
  }

  @Put(':campaignId/submission/draft')
  saveDraft(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: SaveSubmissionDraftDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.submissionsService.saveDraft(campaignId, dto, request.user);
  }

  @Post(':campaignId/submission/submit')
  submit(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.submissionsService.submit(campaignId, request.user);
  }
}

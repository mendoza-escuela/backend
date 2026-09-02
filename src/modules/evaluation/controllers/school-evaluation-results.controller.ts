import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { EvaluationResultsService } from '../services/evaluation-results.service';

@Controller('school/campaigns')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.School)
export class SchoolEvaluationResultsController {
  constructor(
    private readonly evaluationResultsService: EvaluationResultsService,
  ) {}

  @Get(':campaignId/submission/result')
  result(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.evaluationResultsService.resultForSchool(
      campaignId,
      request.user,
    );
  }
}

@Controller('school/results')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.School)
export class SchoolPreliminaryResultsController {
  constructor(
    private readonly evaluationResultsService: EvaluationResultsService,
  ) {}

  @Get()
  list(@Req() request: Request & { user: AuthenticatedUser }) {
    return this.evaluationResultsService.resultsForSchool(request.user);
  }
}

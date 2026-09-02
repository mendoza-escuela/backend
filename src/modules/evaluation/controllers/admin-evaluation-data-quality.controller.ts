import {
  Body,
  Controller,
  Get,
  Post,
  Query,
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
  KioskApplicabilityAuditQueryDto,
  KioskApplicabilityDataRepairDto,
  KioskApplicabilityDataRepairPreviewDto,
} from '../dto/kiosk-applicability-data-repair.dto';
import { KioskApplicabilityDataRepairService } from '../services/kiosk-applicability-data-repair.service';

@Controller('admin/evaluation/data-quality/kiosk-applicability')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminEvaluationDataQualityController {
  constructor(
    private readonly dataRepair: KioskApplicabilityDataRepairService,
  ) {}

  @Get()
  audit(@Query() query: KioskApplicabilityAuditQueryDto) {
    return this.dataRepair.audit(query.campaignId);
  }

  @Post('preview')
  preview(@Body() dto: KioskApplicabilityDataRepairPreviewDto) {
    return this.dataRepair.preview(dto.submissionIds);
  }

  @Post('repair')
  repair(
    @Body() dto: KioskApplicabilityDataRepairDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.dataRepair.repair(
      dto.targets.map(({ submissionId }) => submissionId),
      dto.previewFingerprint,
      dto.confirm,
      request.user.id,
    );
  }
}

import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, IsNull } from 'typeorm';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CampaignSchool } from '../../campaigns/entities/campaign-school.entity';
import { EvaluationResult } from '../../evaluation/entities/evaluation-result.entity';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { ResultsDashboardService } from '../services/results-dashboard.service';

@Controller('school/campaigns')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.School)
export class SchoolResultsDashboardController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly results: ResultsDashboardService,
  ) {}

  @Get(':campaignId/star-distribution')
  async distribution(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    if (!this.enabled())
      throw new NotFoundException(
        'La distribución de estrellas todavía no está habilitada.',
      );
    const association = await this.dataSource
      .getRepository(UserSchool)
      .findOne({
        where: { userId: request.user.id },
        relations: { school: true },
      });
    if (!association)
      throw new NotFoundException(
        'No existe una escuela asociada a tu cuenta.',
      );
    const assigned = await this.dataSource
      .getRepository(CampaignSchool)
      .exists({
        where: {
          campaignId,
          schoolId: association.schoolId,
          removedAt: IsNull(),
        },
      });
    if (!assigned)
      throw new NotFoundException(
        'La etapa no está disponible para tu escuela.',
      );
    const own = await this.dataSource.getRepository(EvaluationResult).findOne({
      select: { stars: true },
      where: { campaignId, schoolId: association.schoolId },
    });
    if (!own)
      throw new NotFoundException(
        'La escuela todavía no posee un resultado para esta etapa.',
      );
    const scope = this.config.get<string>('SCHOOL_STAR_DISTRIBUTION_SCOPE');
    const distribution = await this.results.distribution({
      campaignId,
      ...(scope === 'department'
        ? { department: association.school.department }
        : {}),
    });
    const configuredMinimum = Number(
      this.config.get<string>('SCHOOL_STAR_DISTRIBUTION_MIN_SAMPLE') || 5,
    );
    const minimumSample =
      Number.isInteger(configuredMinimum) && configuredMinimum >= 3
        ? configuredMinimum
        : 5;
    if (distribution.denominator < minimumSample)
      return {
        available: false,
        reason: 'insufficient_sample',
        minimumSample,
        denominator: distribution.denominator,
        items: [],
        ownStars: null,
      };
    return {
      available: true,
      scope: scope === 'department' ? 'department' : 'province',
      denominator: distribution.denominator,
      items: distribution.items.map(({ stars, count, percentage }) => ({
        stars,
        count,
        percentage,
      })),
      ownStars: own.stars ?? null,
    };
  }

  private enabled() {
    return (
      this.config.get<string>('SCHOOL_STAR_DISTRIBUTION_ENABLED') === 'true'
    );
  }
}

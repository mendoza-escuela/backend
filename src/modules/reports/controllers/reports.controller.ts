import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { IndividualReportService } from '../services/individual-report.service';
import { PdfReportRenderer } from '../services/pdf-report.renderer';

abstract class BaseReportsController {
  constructor(
    protected readonly reports: IndividualReportService,
    protected readonly renderer: PdfReportRenderer,
    protected readonly dataSource: DataSource,
  ) {}

  protected async send(
    type: 'report' | 'receipt',
    campaignId: string,
    schoolId: string,
    actor: AuthenticatedUser,
    response: Response,
  ) {
    const view = await this.reports.get(campaignId, schoolId);
    const document =
      type === 'report'
        ? this.renderer.report(view)
        : this.renderer.receipt(view);
    await this.dataSource.getRepository(AuditLog).save({
      actorUserId: actor.id,
      action:
        type === 'report'
          ? 'INDIVIDUAL_REPORT_DOWNLOADED'
          : 'RECEIPT_DOWNLOADED',
      entityType: 'SurveySubmission',
      entityId: view.submission.id,
      changes: { campaignId, schoolId },
    });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${type === 'report' ? 'reporte' : 'comprobante'}-${this.filePart(view.school.cue)}.pdf"`,
    );
    document.pipe(response);
    document.end();
  }

  private filePart(value: string) {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-') || 'escuela';
  }
}

@Controller('school/campaigns')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.School)
export class SchoolReportsController extends BaseReportsController {
  constructor(
    reports: IndividualReportService,
    renderer: PdfReportRenderer,
    @InjectDataSource() dataSource: DataSource,
  ) {
    super(reports, renderer, dataSource);
  }

  @Get(':campaignId/submission/report.pdf')
  async report(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() request: Request & { user: AuthenticatedUser },
    @Res() response: Response,
  ) {
    const schoolId = await this.schoolId(request.user.id);
    return this.send('report', campaignId, schoolId, request.user, response);
  }

  @Get(':campaignId/submission/receipt.pdf')
  async receipt(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() request: Request & { user: AuthenticatedUser },
    @Res() response: Response,
  ) {
    const schoolId = await this.schoolId(request.user.id);
    return this.send('receipt', campaignId, schoolId, request.user, response);
  }

  private async schoolId(userId: string) {
    const association = await this.dataSource
      .getRepository(UserSchool)
      .findOneBy({ userId });
    if (!association)
      throw new NotFoundException(
        'No existe una escuela asociada a tu cuenta.',
      );
    return association.schoolId;
  }
}

@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminReportsController extends BaseReportsController {
  constructor(
    reports: IndividualReportService,
    renderer: PdfReportRenderer,
    @InjectDataSource() dataSource: DataSource,
  ) {
    super(reports, renderer, dataSource);
  }

  @Get(':campaignId/schools/:schoolId/report.pdf')
  report(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Req() request: Request & { user: AuthenticatedUser },
    @Res() response: Response,
  ) {
    return this.send('report', campaignId, schoolId, request.user, response);
  }
}

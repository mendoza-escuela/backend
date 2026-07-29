import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { Response } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { CompareSurveyVersionsQueryDto } from '../dto/compare-survey-versions-query.dto';
import { CreateSurveyVersionDto } from '../dto/create-survey-version.dto';
import { CreateSurveyDto } from '../dto/create-survey.dto';
import { ListSurveysQueryDto } from '../dto/list-surveys-query.dto';
import { ImportSurveyVersionDto } from '../dto/import-survey-version.dto';
import { UpdateSurveyVersionDto } from '../dto/update-survey-version.dto';
import { UpdateSurveyDto } from '../dto/update-survey.dto';
import { AdminSurveysService } from '../services/admin-surveys.service';
import { BulkSurveyImportService } from '../services/bulk-survey-import.service';

@Controller('admin/surveys')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminSurveysController {
  constructor(
    private readonly surveysService: AdminSurveysService,
    private readonly bulkImportService: BulkSurveyImportService,
  ) {}

  @Get()
  list(@Query() query: ListSurveysQueryDto) {
    return this.surveysService.list(query);
  }

  @Post()
  create(
    @Body() dto: CreateSurveyDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.surveysService.createSurvey(dto, request.user);
  }

  @Get('templates/official-dimensions')
  officialDimensionsTemplate() {
    return this.surveysService.getOfficialDimensionsTemplate();
  }

  @Get('import/template')
  @Header('Cache-Control', 'no-store')
  async importTemplate(
    @Query('format') requestedFormat: string,
    @Res() response: Response,
  ) {
    const format = requestedFormat === 'csv' ? 'csv' : 'xlsx';
    const template = await this.bulkImportService.template(format);
    response.setHeader('Content-Type', template.mime);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="plantilla-cuestionario.${template.extension}"`,
    );
    response.send(template.buffer);
  }

  @Post(':surveyId/import/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  previewImport(
    @Param('surveyId', ParseUUIDPipe) _surveyId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.bulkImportService.preview(file);
  }

  @Post(':surveyId/import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  importVersion(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ImportSurveyVersionDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.bulkImportService.import(surveyId, file, dto, request.user);
  }

  @Get(':surveyId')
  findOne(@Param('surveyId', ParseUUIDPipe) surveyId: string) {
    return this.surveysService.findOne(surveyId);
  }

  @Patch(':surveyId')
  update(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: UpdateSurveyDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.surveysService.updateSurvey(surveyId, dto, request.user);
  }

  @Delete(':surveyId')
  @HttpCode(204)
  remove(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.surveysService.deleteSurvey(surveyId, request.user);
  }

  @Get(':surveyId/versions/compare')
  compare(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Query() query: CompareSurveyVersionsQueryDto,
  ) {
    return this.surveysService.compareVersions(surveyId, query);
  }

  @Post(':surveyId/versions')
  createVersion(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Body() dto: CreateSurveyVersionDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.surveysService.createVersion(surveyId, dto, request.user);
  }

  @Get(':surveyId/versions/:versionId')
  findVersion(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.surveysService.findVersion(surveyId, versionId);
  }

  @Put(':surveyId/versions/:versionId')
  updateVersion(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: UpdateSurveyVersionDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.surveysService.updateVersion(
      surveyId,
      versionId,
      dto,
      request.user,
    );
  }

  @Post(':surveyId/versions/:versionId/publish')
  publishVersion(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.surveysService.publishVersion(
      surveyId,
      versionId,
      request.user,
    );
  }

  @Get(':surveyId/versions/:versionId/validation')
  validateVersion(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.surveysService.validateVersion(surveyId, versionId);
  }

  @Delete(':surveyId/versions/:versionId')
  @HttpCode(204)
  removeVersion(
    @Param('surveyId', ParseUUIDPipe) surveyId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.surveysService.deleteVersion(surveyId, versionId, request.user);
  }
}

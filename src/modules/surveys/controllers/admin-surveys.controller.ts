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
  Put,
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
import { CompareSurveyVersionsQueryDto } from '../dto/compare-survey-versions-query.dto';
import { CreateSurveyVersionDto } from '../dto/create-survey-version.dto';
import { CreateSurveyDto } from '../dto/create-survey.dto';
import { ListSurveysQueryDto } from '../dto/list-surveys-query.dto';
import { UpdateSurveyVersionDto } from '../dto/update-survey-version.dto';
import { UpdateSurveyDto } from '../dto/update-survey.dto';
import { AdminSurveysService } from '../services/admin-surveys.service';

@Controller('admin/surveys')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminSurveysController {
  constructor(private readonly surveysService: AdminSurveysService) {}

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

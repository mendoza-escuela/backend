import { importFileFilter } from '../../../common/uploads/import-file.filter';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { AssignSchoolUserDto } from '../dto/assign-school-user.dto';
import { AdminRectifySchoolDto } from '../dto/admin-rectify-school.dto';
import { CreateSchoolDto } from '../dto/create-school.dto';
import { ListAssignableUsersQueryDto } from '../dto/list-assignable-users-query.dto';
import { ListSchoolsQueryDto } from '../dto/list-schools-query.dto';
import { SetSchoolStatusDto } from '../dto/set-school-status.dto';
import { UpdateSchoolDto } from '../dto/update-school.dto';
import { BulkSchoolImportService } from '../services/bulk-school-import.service';
import { SchoolsService } from '../services/schools.service';

@Controller('admin/schools')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminSchoolsController {
  constructor(
    private readonly schoolsService: SchoolsService,
    private readonly bulkImport: BulkSchoolImportService,
  ) {}
  @Get() list(@Query() query: ListSchoolsQueryDto) {
    return this.schoolsService.list(query);
  }
  @Get('filters') filters() {
    return this.schoolsService.filterOptions();
  }
  @Get('rectification/catalogs') rectificationCatalogs() {
    return this.schoolsService.rectificationCatalogs();
  }
  @Get('import/template')
  template() {
    return new StreamableFile(this.bulkImport.template(), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="plantilla-colegios.csv"',
    });
  }
  @Post('import/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
      fileFilter: importFileFilter,
    }),
  )
  preview(@UploadedFile() file: Express.Multer.File) {
    return this.bulkImport.preview(file);
  }
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
      fileFilter: importFileFilter,
    }),
  )
  importSchools(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.bulkImport.import(file, request.user);
  }
  @Get('export') async export(
    @Query() query: ListSchoolsQueryDto,
    @Query('format') requestedFormat: string,
    @Req() request: Request & { user: AuthenticatedUser },
    @Res() response: Response,
  ) {
    const format = requestedFormat === 'xlsx' ? 'xlsx' : 'csv';
    const exported = await this.schoolsService.export(
      query,
      format,
      request.user,
    );
    response.setHeader('Content-Type', exported.mime);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="padron-colegios.${exported.extension}"`,
    );
    response.send(exported.buffer);
  }
  @Get(':id/assignable-users') assignableUsers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListAssignableUsersQueryDto,
  ) {
    return this.schoolsService.listAssignableUsers(id, query);
  }
  @Get(':id') findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.schoolsService.findOne(id);
  }
  @Post() create(
    @Body() dto: CreateSchoolDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.schoolsService.create(dto, request.user);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchoolDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.schoolsService.update(id, dto, request.user);
  }
  @Patch(':id/status') status(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetSchoolStatusDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.schoolsService.setStatus(id, dto.isActive, request.user);
  }
  @Patch(':id/user') assignUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSchoolUserDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.schoolsService.assignUser(id, dto, request.user);
  }

  @Put(':id/rectification')
  rectify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminRectifySchoolDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.schoolsService.rectifyAsAdmin(id, dto, request.user);
  }
}

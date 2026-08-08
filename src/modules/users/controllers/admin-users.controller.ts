import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../entities/user-role.enum';
import { AdminResetPasswordDto } from '../dto/admin-reset-password.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { SearchSchoolOptionsQueryDto } from '../dto/search-school-options-query.dto';
import { SetUserStatusDto } from '../dto/set-user-status.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { AdminUsersService } from '../services/admin-users.service';
import { BulkUserImportService } from '../services/bulk-user-import.service';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin)
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly bulkImportService: BulkUserImportService,
  ) {}

  @Get()
  list(@Query() query: ListUsersQueryDto) {
    return this.adminUsersService.list(query);
  }

  @Get('schools')
  schools(@Query() query: SearchSchoolOptionsQueryDto) {
    return this.adminUsersService.listSchools(query);
  }

  @Get('import/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  template(@Res({ passthrough: true }) response: Response) {
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="plantilla-usuarios.csv"',
    );
    return this.bulkImportService.template();
  }

  @Post('import/preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  preview(@UploadedFile() file: Express.Multer.File) {
    return this.bulkImportService.preview(file);
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  importUsers(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.bulkImportService.import(file, request.user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateUserDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.adminUsersService.create(dto, request.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.adminUsersService.update(id, dto, request.user);
  }

  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.adminUsersService.setStatus(id, dto.isActive, request.user);
  }

  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminResetPasswordDto,
    @Req() request: Request & { user: AuthenticatedUser },
  ) {
    return this.adminUsersService.resetPassword(
      id,
      dto.temporaryPassword,
      request.user,
    );
  }
}

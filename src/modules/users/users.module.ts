import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserSchool } from './entities/user-school.entity';
import { UsersService } from './services/users.service';
import { SchoolAccessGuard } from '../../common/guards/school-access.guard';
import { School } from '../schools/entities/school.entity';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminUsersService } from './services/admin-users.service';
import { BulkUserImportService } from './services/bulk-user-import.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PasswordChangeRequiredGuard } from '../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserSchool, School, AuthSession, AuditLog]),
  ],
  controllers: [AdminUsersController],
  providers: [
    UsersService,
    AdminUsersService,
    BulkUserImportService,
    SchoolAccessGuard,
    JwtAuthGuard,
    PasswordChangeRequiredGuard,
    RolesGuard,
  ],
  exports: [UsersService, SchoolAccessGuard, TypeOrmModule],
})
export class UsersModule {}

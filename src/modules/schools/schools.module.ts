import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserSchool } from '../users/entities/user-school.entity';
import { User } from '../users/entities/user.entity';
import { PasswordChangeRequiredGuard } from '../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminSchoolsController } from './controllers/admin-schools.controller';
import { SchoolUserAssignmentHistory } from './entities/school-user-assignment-history.entity';
import { School } from './entities/school.entity';
import { BulkSchoolImportService } from './services/bulk-school-import.service';
import { SchoolsService } from './services/schools.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      School,
      SchoolUserAssignmentHistory,
      User,
      UserSchool,
      AuthSession,
      AuditLog,
    ]),
  ],
  controllers: [AdminSchoolsController],
  providers: [
    SchoolsService,
    BulkSchoolImportService,
    JwtAuthGuard,
    PasswordChangeRequiredGuard,
    RolesGuard,
  ],
  exports: [SchoolsService],
})
export class SchoolsModule {}

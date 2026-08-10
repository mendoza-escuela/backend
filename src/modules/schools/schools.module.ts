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
import { SchoolPortalController } from './controllers/school-portal.controller';
import { SchoolUserAssignmentHistory } from './entities/school-user-assignment-history.entity';
import { School } from './entities/school.entity';
import { SchoolContact } from './entities/school-contact.entity';
import { SchoolRectification } from './entities/school-rectification.entity';
import { EducationLevelCatalog } from './entities/education-level-catalog.entity';
import { SchoolEducationLevel } from './entities/school-education-level.entity';
import { SchoolRectificationEducationLevel } from './entities/school-rectification-education-level.entity';
import { SchoolShiftCatalog } from './entities/school-shift-catalog.entity';
import { BulkSchoolImportService } from './services/bulk-school-import.service';
import { SchoolsService } from './services/schools.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      School,
      SchoolContact,
      SchoolRectification,
      SchoolRectificationEducationLevel,
      SchoolEducationLevel,
      SchoolShiftCatalog,
      EducationLevelCatalog,
      SchoolUserAssignmentHistory,
      User,
      UserSchool,
      AuthSession,
      AuditLog,
    ]),
  ],
  controllers: [AdminSchoolsController, SchoolPortalController],
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

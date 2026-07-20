import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserSchool } from './entities/user-school.entity';
import { UsersService } from './services/users.service';
import { SchoolAccessGuard } from '../../common/guards/school-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserSchool])],
  providers: [UsersService, SchoolAccessGuard],
  exports: [UsersService, SchoolAccessGuard, TypeOrmModule],
})
export class UsersModule {}

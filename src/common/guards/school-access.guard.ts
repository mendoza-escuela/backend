import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { UserSchool } from '../../modules/users/entities/user-school.entity';
import { AuthenticatedUser } from '../types/authenticated-user.type';

/** Impide que un perfil Colegio acceda a recursos de un establecimiento no asociado. */
@Injectable()
export class SchoolAccessGuard implements CanActivate {
  constructor(
    @InjectRepository(UserSchool)
    private readonly userSchoolsRepository: Repository<UserSchool>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params: { schoolId?: string };
    }>();
    if (!request.user) return false;
    if (request.user.role === UserRole.Admin) return true;

    const schoolId = request.params.schoolId;
    const association = schoolId
      ? await this.userSchoolsRepository.findOneBy({
          userId: request.user.id,
          schoolId,
        })
      : null;
    if (!association)
      throw new ForbiddenException('No tenés acceso a este establecimiento.');
    return true;
  }
}

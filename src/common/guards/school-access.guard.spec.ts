import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { UserSchool } from '../../modules/users/entities/user-school.entity';
import { SchoolAccessGuard } from './school-access.guard';

function context(role: UserRole, schoolId = 'school-id'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 'user-id', role },
        params: { schoolId },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('SchoolAccessGuard', () => {
  const findOneBy = jest.fn();
  const guard = new SchoolAccessGuard({
    findOneBy,
  } as unknown as Repository<UserSchool>);

  beforeEach(() => findOneBy.mockReset());

  it('allows administrators to access any school', async () => {
    await expect(guard.canActivate(context(UserRole.Admin))).resolves.toBe(
      true,
    );
    expect(findOneBy).not.toHaveBeenCalled();
  });

  it('allows a school user only when an association exists', async () => {
    findOneBy.mockResolvedValue({ userId: 'user-id', schoolId: 'school-id' });
    await expect(guard.canActivate(context(UserRole.School))).resolves.toBe(
      true,
    );
  });

  it('denies access to a different school', async () => {
    findOneBy.mockResolvedValue(null);
    await expect(
      guard.canActivate(context(UserRole.School)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

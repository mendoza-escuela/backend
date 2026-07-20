import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../modules/users/entities/user-role.enum';
import { RolesGuard } from './roles.guard';

function contextWithRole(role?: UserRole): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows a route without role metadata', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextWithRole())).toBe(true);
  });

  it('allows only a listed role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.Admin]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithRole(UserRole.Admin))).toBe(true);
    expect(guard.canActivate(contextWithRole(UserRole.School))).toBe(false);
  });

  it('denies unauthenticated requests to protected routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([UserRole.Admin]),
    } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextWithRole())).toBe(
      false,
    );
  });
});

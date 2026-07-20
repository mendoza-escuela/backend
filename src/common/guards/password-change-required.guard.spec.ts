import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PasswordChangeRequiredGuard } from './password-change-required.guard';

function context(mustChangePassword: boolean): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { mustChangePassword } }),
    }),
  } as unknown as ExecutionContext;
}

describe('PasswordChangeRequiredGuard', () => {
  const guard = new PasswordChangeRequiredGuard();

  it('blocks access until the initial password is changed', () => {
    expect(() => guard.canActivate(context(true))).toThrow(ForbiddenException);
  });

  it('allows access after the password is changed', () => {
    expect(guard.canActivate(context(false))).toBe(true);
  });
});

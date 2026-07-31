import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    _error: unknown,
    user: TUser | false | null,
  ): TUser {
    if (!user) {
      throw new UnauthorizedException(
        'Tu sesión no es válida o venció. Volvé a iniciar sesión.',
      );
    }
    return user;
  }
}

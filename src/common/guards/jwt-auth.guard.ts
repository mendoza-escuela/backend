import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

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

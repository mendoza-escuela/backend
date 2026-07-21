import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user.type';

@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (request.user?.mustChangePassword) {
      throw new ForbiddenException(
        'Debés cambiar tu contraseña antes de continuar.',
      );
    }
    return true;
  }
}

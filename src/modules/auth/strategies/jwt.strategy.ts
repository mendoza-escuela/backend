import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuthService } from '../services/auth.service';

type JwtPayload = { sub: string; sid: string };

function extractAccessToken(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  const cookieToken = cookieHeader
    ?.split(';')
    .map((cookie) => cookie.trim().split('='))
    .find(([name]) => name === 'access_token')?.[1];
  return cookieToken
    ? decodeURIComponent(cookieToken)
    : ExtractJwt.fromAuthHeaderAsBearerToken()(request);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
      // Lista blanca explícita de algoritmos: sin ella se acepta el algoritmo
      // declarado en el header del propio token. Los tokens se firman con el
      // secreto HMAC de JWT_SECRET, por lo que HS256 es el único válido.
      // ASVS 5.0 V3.5.3 (hallazgo H-01).
      algorithms: ['HS256'],
    });
  }

  validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return this.authService.validateSession(payload.sub, payload.sid);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { LoginDto } from '../dto/login.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AuthService } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const loginResult = await this.authService.login(
      loginDto.email,
      loginDto.password,
    );
    this.setAuthCookie(
      response,
      loginResult.accessToken,
      loginResult.expiresAt,
    );
    return { user: loginResult.user };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() request: Request & { user: AuthenticatedUser },
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.user.sessionId);
    response.clearCookie('access_token', this.cookieOptions());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: Request & { user: AuthenticatedUser }) {
    return { user: request.user };
  }

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    return {
      message:
        'Si el correo está registrado, recibirás un enlace para restablecer la contraseña.',
    };
  }

  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    response.clearCookie('access_token', this.cookieOptions());
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  changePassword(
    @Req() request: Request & { user: AuthenticatedUser },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      request.user,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  private setAuthCookie(
    response: Response,
    token: string,
    expires: Date,
  ): void {
    response.cookie('access_token', token, {
      ...this.cookieOptions(),
      expires,
    });
  }

  private cookieOptions() {
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    return {
      httpOnly: true,
      secure: isProduction,
      // El frontend y la API se despliegan en hosts distintos. En producción,
      // SameSite=None permite CORS y Partitioned evita el bloqueo de cookies de
      // terceros manteniendo el JWT aislado para este frontend.
      sameSite: isProduction ? ('none' as const) : ('lax' as const),
      partitioned: isProduction,
      path: '/',
    };
  }
}

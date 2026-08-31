import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthSession } from './entities/auth-session.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { MailModule } from '../mail/mail.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PasswordChangeRequiredGuard } from '../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    UsersModule,
    MailModule,
    TypeOrmModule.forFeature([AuthSession, PasswordResetToken]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn:
            configService.getOrThrow<NonNullable<JwtSignOptions['expiresIn']>>(
              'JWT_EXPIRES_IN',
            ),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    PasswordChangeRequiredGuard,
    RolesGuard,
  ],
  exports: [JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard],
})
export class AuthModule {}

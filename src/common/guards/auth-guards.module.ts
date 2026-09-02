import { Module } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordChangeRequiredGuard } from './password-change-required.guard';
import { RolesGuard } from './roles.guard';

/** Provee una única instancia modular de los guards comunes de acceso. */
@Module({
  providers: [JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard],
  exports: [JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard],
})
export class AuthGuardsModule {}

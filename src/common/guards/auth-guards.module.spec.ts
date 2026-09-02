import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from '../../modules/auth/auth.module';
import { SchoolsModule } from '../../modules/schools/schools.module';
import { UsersModule } from '../../modules/users/users.module';
import { AuthGuardsModule } from './auth-guards.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordChangeRequiredGuard } from './password-change-required.guard';
import { RolesGuard } from './roles.guard';

describe('AuthGuardsModule', () => {
  it('provides every shared access guard from one module', async () => {
    const module = await Test.createTestingModule({
      imports: [AuthGuardsModule],
    }).compile();

    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    expect(module.get(PasswordChangeRequiredGuard)).toBeInstanceOf(
      PasswordChangeRequiredGuard,
    );
    expect(module.get(RolesGuard)).toBeInstanceOf(RolesGuard);
  });

  it('is the only module that registers the shared guard providers', () => {
    const sharedGuards = [
      JwtAuthGuard,
      PasswordChangeRequiredGuard,
      RolesGuard,
    ];
    const providers = (moduleType: object) =>
      (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleType) ??
        []) as unknown[];
    const imports = (moduleType: object) =>
      (Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ??
        []) as unknown[];

    expect(providers(AuthGuardsModule)).toEqual(
      expect.arrayContaining(sharedGuards),
    );
    for (const featureModule of [AuthModule, UsersModule, SchoolsModule]) {
      expect(providers(featureModule)).not.toEqual(
        expect.arrayContaining(sharedGuards),
      );
      expect(imports(featureModule)).toContain(AuthGuardsModule);
    }
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule)).toContain(
      AuthGuardsModule,
    );
  });
});

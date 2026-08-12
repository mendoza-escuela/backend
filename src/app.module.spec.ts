import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';
import { CsrfProtectionGuard } from './common/guards/csrf-protection.guard';
import { AppModule } from './app.module';

type GlobalGuardProvider = {
  provide: unknown;
  useClass: new (...args: never[]) => unknown;
};

describe('AppModule security guards', () => {
  it('registra globalmente rate limiting y protección CSRF', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AppModule,
    ) as GlobalGuardProvider[];
    const globalGuards = providers
      .filter(({ provide }) => provide === APP_GUARD)
      .map(({ useClass }) => useClass);

    expect(globalGuards).toEqual(
      expect.arrayContaining([ThrottlerGuard, CsrfProtectionGuard]),
    );

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: APP_FILTER,
          useClass: ThrottlerExceptionFilter,
        }),
      ]),
    );
  });
});

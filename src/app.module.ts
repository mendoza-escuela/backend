import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { DatabaseModule } from './database/database.module';
import { validateEnvironment } from './config/env.validation';
import { SchoolsModule } from './modules/schools/schools.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { EvaluationModule } from './modules/evaluation/evaluation.module';
import { EvaluationConfigModule } from './modules/evaluation-config/evaluation-config.module';
import { ExportsModule } from './modules/exports/exports.module';
import { ReportsModule } from './modules/reports/reports.module';
import { CsrfProtectionGuard } from './common/guards/csrf-protection.guard';
import { ThrottlerExceptionFilter } from './common/filters/throttler-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 300,
      },
    ]),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    UsersModule,
    SchoolsModule,
    SurveysModule,
    CampaignsModule,
    SubmissionsModule,
    DashboardModule,
    EvaluationModule,
    EvaluationConfigModule,
    ExportsModule,
    ReportsModule,
    AuthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfProtectionGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ThrottlerExceptionFilter,
    },
  ],
})
export class AppModule {}

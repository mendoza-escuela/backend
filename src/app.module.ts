import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
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
    AuthModule,
  ],
})
export class AppModule {}

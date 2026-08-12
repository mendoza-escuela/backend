import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { ResultsDashboardService } from '../services/results-dashboard.service';
import { AdminResultsDashboardController } from './admin-results-dashboard.controller';

@Injectable()
class TestSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();
    const role = request.headers['x-test-role'];
    if (role !== UserRole.Admin && role !== UserRole.School)
      throw new UnauthorizedException();
    request.user = {
      id: 'user-id',
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      role,
      sessionId: 'session-id',
      mustChangePassword: false,
      lastLoginAt: null,
    };
    return true;
  }
}

describe('Results comparison dashboard authorization and contract', () => {
  let app: INestApplication;
  let server: Server;
  const firstCampaignId = '73bb46f3-5060-4d69-91d9-f18ce6d648f2';
  const secondCampaignId = '73bb46f3-5060-4d69-91d9-f18ce6d648f3';
  const schoolId = '73bb46f3-5060-4d69-91d9-f18ce6d648f4';
  const dashboard = {
    metrics: jest.fn(),
    distribution: jest.fn(),
    criticalAlerts: jest.fn(),
    comparison: jest.fn().mockResolvedValue({ periods: [] }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminResultsDashboardController],
      providers: [
        { provide: ResultsDashboardService, useValue: dashboard },
        JwtAuthGuard,
        PasswordChangeRequiredGuard,
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestSessionGuard)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const comparisonPath =
    `/api/admin/dashboard/results/comparison?campaignIds=${firstCampaignId}` +
    `&campaignIds=${secondCampaignId}&schoolIds=${schoolId}`;

  it('protege la comparación con autenticación y rol administrador', async () => {
    await request(server).get(comparisonPath).expect(401);
    await request(server)
      .get(comparisonPath)
      .set('x-test-role', UserRole.School)
      .expect(403);
    expect(dashboard.comparison).not.toHaveBeenCalled();
  });

  it('normaliza etapas repetidas y filtros institucionales', async () => {
    await request(server)
      .get(`${comparisonPath}&departments=Capital&departments=Lavalle`)
      .set('x-test-role', UserRole.Admin)
      .expect(200);

    expect(dashboard.comparison).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignIds: [firstCampaignId, secondCampaignId],
        schoolIds: [schoolId],
        departments: ['Capital', 'Lavalle'],
      }),
    );
  });

  it('rechaza IDs duplicados antes de invocar el servicio', async () => {
    await request(server)
      .get(`${comparisonPath}&campaignIds=${firstCampaignId}`)
      .set('x-test-role', UserRole.Admin)
      .expect(400);
    expect(dashboard.comparison).not.toHaveBeenCalled();
  });

  it.each([
    'submissionStatuses=submitted',
    'stars=5',
    'criticalAreas=salud_mental',
  ])('rechaza el filtro de outcome %s', async (outcomeFilter) => {
    await request(server)
      .get(`${comparisonPath}&${outcomeFilter}`)
      .set('x-test-role', UserRole.Admin)
      .expect(400);
    expect(dashboard.comparison).not.toHaveBeenCalled();
  });
});

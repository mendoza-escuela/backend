import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { AdminSurveysService } from '../services/admin-surveys.service';
import { ApplicabilityRulesService } from '../services/applicability-rules.service';
import { BulkSurveyImportService } from '../services/bulk-survey-import.service';
import { SurveysService } from '../services/surveys.service';
import { AdminSurveysController } from './admin-surveys.controller';
import { SurveysController } from './surveys.controller';

/** Simula una sesión ya validada para probar la autorización HTTP sin BD. */
@Injectable()
class TestSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();
    const role = request.headers['x-test-role'];
    if (role !== UserRole.Admin && role !== UserRole.School)
      throw new UnauthorizedException();

    request.user = {
      id: `${role}-user-id`,
      firstName: 'Usuario',
      lastName: 'Prueba',
      email: `${role}@example.com`,
      role,
      sessionId: 'session-id',
      mustChangePassword: request.headers['x-must-change-password'] === 'true',
      lastLoginAt: null,
    };
    return true;
  }
}

describe('Survey routes authorization', () => {
  let app: INestApplication;
  let httpServer: Server;
  const surveysService = {
    listAvailable: jest.fn().mockResolvedValue([]),
  };
  const adminSurveysService = {
    list: jest.fn().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SurveysController, AdminSurveysController],
      providers: [
        { provide: SurveysService, useValue: surveysService },
        { provide: AdminSurveysService, useValue: adminSurveysService },
        { provide: BulkSurveyImportService, useValue: {} },
        { provide: ApplicabilityRulesService, useValue: {} },
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
    await app.init();
    const initializedServer: unknown = app.getHttpServer();
    httpServer = initializedServer as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('rejects unauthenticated requests to published surveys', async () => {
    await request(httpServer).get('/api/surveys/available').expect(401);
    expect(surveysService.listAvailable).not.toHaveBeenCalled();
  });

  it.each([UserRole.Admin, UserRole.School])(
    'allows the %s role to read published surveys',
    async (role) => {
      await request(httpServer)
        .get('/api/surveys/available')
        .set('x-test-role', role)
        .expect(200, []);
      expect(surveysService.listAvailable).toHaveBeenCalledTimes(1);
    },
  );

  it('blocks survey access until the initial password is changed', async () => {
    await request(httpServer)
      .get('/api/surveys/available')
      .set('x-test-role', UserRole.School)
      .set('x-must-change-password', 'true')
      .expect(403);
    expect(surveysService.listAvailable).not.toHaveBeenCalled();
  });

  it('rejects a school user from survey administration', async () => {
    await request(httpServer)
      .get('/api/admin/surveys')
      .set('x-test-role', UserRole.School)
      .expect(403);
    expect(adminSurveysService.list).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests to survey administration', async () => {
    await request(httpServer).get('/api/admin/surveys').expect(401);
    expect(adminSurveysService.list).not.toHaveBeenCalled();
  });

  it('blocks survey administration until the password is changed', async () => {
    await request(httpServer)
      .get('/api/admin/surveys')
      .set('x-test-role', UserRole.Admin)
      .set('x-must-change-password', 'true')
      .expect(403);
    expect(adminSurveysService.list).not.toHaveBeenCalled();
  });

  it('allows an administrator to access survey administration', async () => {
    await request(httpServer)
      .get('/api/admin/surveys')
      .set('x-test-role', UserRole.Admin)
      .expect(200);
    expect(adminSurveysService.list).toHaveBeenCalledTimes(1);
  });
});

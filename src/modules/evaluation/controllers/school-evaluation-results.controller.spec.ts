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
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { EvaluationResultsService } from '../services/evaluation-results.service';
import {
  SchoolEvaluationResultsController,
  SchoolPreliminaryResultsController,
} from './school-evaluation-results.controller';

@Injectable()
class TestSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();
    const role = request.headers['x-test-role'];
    if (role !== UserRole.Admin && role !== UserRole.School) {
      throw new UnauthorizedException();
    }
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

describe('School evaluation result authorization', () => {
  const campaignId = '1a2aa1a2-d2e8-4f64-aa90-94a954589062';
  const evaluationResultsService = {
    resultForSchool: jest.fn().mockResolvedValue({ id: 'result-id' }),
    resultsForSchool: jest.fn().mockResolvedValue({ items: [] }),
  };
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        SchoolEvaluationResultsController,
        SchoolPreliminaryResultsController,
      ],
      providers: [
        {
          provide: EvaluationResultsService,
          useValue: evaluationResultsService,
        },
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
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => app.close());

  beforeEach(() => jest.clearAllMocks());

  it('allows the school role to query its own campaign result', async () => {
    await request(httpServer)
      .get(`/api/school/campaigns/${campaignId}/submission/result`)
      .set('x-test-role', UserRole.School)
      .expect(200, { id: 'result-id' });

    expect(evaluationResultsService.resultForSchool).toHaveBeenCalledWith(
      campaignId,
      expect.objectContaining({
        id: `${UserRole.School}-user-id`,
        role: UserRole.School,
      }),
    );
  });

  it('rejects unauthenticated and administrative sessions', async () => {
    await request(httpServer)
      .get(`/api/school/campaigns/${campaignId}/submission/result`)
      .expect(401);
    await request(httpServer)
      .get(`/api/school/campaigns/${campaignId}/submission/result`)
      .set('x-test-role', UserRole.Admin)
      .expect(403);
    expect(evaluationResultsService.resultForSchool).not.toHaveBeenCalled();
  });

  it('blocks access until the temporary password is changed', async () => {
    await request(httpServer)
      .get(`/api/school/campaigns/${campaignId}/submission/result`)
      .set('x-test-role', UserRole.School)
      .set('x-must-change-password', 'true')
      .expect(403);
    expect(evaluationResultsService.resultForSchool).not.toHaveBeenCalled();
  });

  it('lists results using only the authenticated school session', async () => {
    await request(httpServer)
      .get('/api/school/results')
      .set('x-test-role', UserRole.School)
      .expect(200, { items: [] });

    expect(evaluationResultsService.resultsForSchool).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${UserRole.School}-user-id`,
        role: UserRole.School,
      }),
    );

    await request(httpServer)
      .get('/api/school/results')
      .set('x-test-role', UserRole.Admin)
      .expect(403);
  });
});

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
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { ParticipationDashboardService } from '../services/participation-dashboard.service';
import { AdminDashboardController } from './admin-dashboard.controller';

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
      sessionId: 'session',
      mustChangePassword: false,
      lastLoginAt: null,
    };
    return true;
  }
}

describe('Participation dashboard authorization', () => {
  let app: INestApplication;
  let server: Server;
  const dashboard = {
    metrics: jest.fn().mockResolvedValue({ metrics: {} }),
    filterOptions: jest.fn().mockResolvedValue({ campaigns: [] }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminDashboardController],
      providers: [
        { provide: ParticipationDashboardService, useValue: dashboard },
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

  it('rejects unauthenticated users', () =>
    request(server)
      .get(
        '/api/admin/dashboard/participation?campaignId=73bb46f3-5060-4d69-91d9-f18ce6d648f2',
      )
      .expect(401));
  it('rejects school users', () =>
    request(server)
      .get(
        '/api/admin/dashboard/participation?campaignId=73bb46f3-5060-4d69-91d9-f18ce6d648f2',
      )
      .set('x-test-role', UserRole.School)
      .expect(403));
  it('allows administrators', async () => {
    await request(server)
      .get(
        '/api/admin/dashboard/participation?campaignId=73bb46f3-5060-4d69-91d9-f18ce6d648f2',
      )
      .set('x-test-role', UserRole.Admin)
      .expect(200);
    expect(dashboard.metrics).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid query parameters before reaching the service', async () => {
    await request(server)
      .get('/api/admin/dashboard/participation?campaignId=invalid')
      .set('x-test-role', UserRole.Admin)
      .expect(400);
    expect(dashboard.metrics).not.toHaveBeenCalled();
  });
});

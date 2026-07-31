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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { AdminSchoolResultDetailService } from '../services/admin-school-result-detail.service';
import { AdminSchoolResultDetailController } from './admin-school-result-detail.controller';

@Injectable()
class TestSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();
    const role = request.headers['x-test-role'];
    if (role !== UserRole.Admin && role !== UserRole.School)
      throw new UnauthorizedException();
    request.user = {
      id: `${role}-id`,
      firstName: 'Usuario',
      lastName: 'Prueba',
      email: `${role}@example.com`,
      role,
      sessionId: 'session',
      mustChangePassword: false,
      lastLoginAt: null,
    };
    return true;
  }
}

describe('AdminSchoolResultDetailController authorization', () => {
  const campaignId = '1a2aa1a2-d2e8-4f64-aa90-94a954589062';
  const schoolId = '923730c1-a978-4bb0-b84f-41cd00d8b37d';
  const detailService = {
    get: jest.fn().mockResolvedValue({ participationStatus: 'not_started' }),
  };
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminSchoolResultDetailController],
      providers: [
        { provide: AdminSchoolResultDetailService, useValue: detailService },
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
    server = app.getHttpServer() as Server;
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('permite al administrador consultar por campaña y escuela', async () => {
    await request(server)
      .get(
        `/api/admin/campaigns/${campaignId}/schools/${schoolId}/result-detail`,
      )
      .set('x-test-role', UserRole.Admin)
      .expect(200);
    expect(detailService.get).toHaveBeenCalledWith(campaignId, schoolId);
  });

  it('rechaza colegios y solicitudes sin autenticar', async () => {
    await request(server)
      .get(
        `/api/admin/campaigns/${campaignId}/schools/${schoolId}/result-detail`,
      )
      .set('x-test-role', UserRole.School)
      .expect(403);
    await request(server)
      .get(
        `/api/admin/campaigns/${campaignId}/schools/${schoolId}/result-detail`,
      )
      .expect(401);
    expect(detailService.get).not.toHaveBeenCalled();
  });

  it('rechaza identificadores inválidos antes de consultar', async () => {
    await request(server)
      .get(`/api/admin/campaigns/invalida/schools/${schoolId}/result-detail`)
      .set('x-test-role', UserRole.Admin)
      .expect(400);
    expect(detailService.get).not.toHaveBeenCalled();
  });
});

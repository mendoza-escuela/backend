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
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { CampaignsService } from '../services/campaigns.service';
import { CampaignTrackingService } from '../services/campaign-tracking.service';
import { CampaignSchoolsService } from '../services/campaign-schools.service';
import { AdminCampaignsController } from './admin-campaigns.controller';

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
      mustChangePassword: false,
      lastLoginAt: null,
    };
    return true;
  }
}

describe('Administrative campaign tracking authorization', () => {
  const campaignId = '1a2aa1a2-d2e8-4f64-aa90-94a954589062';
  const campaignsService = {};
  const campaignTrackingService = {
    summary: jest.fn().mockResolvedValue({ totalSchools: 0 }),
    list: jest.fn().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    }),
  };
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminCampaignsController],
      providers: [
        { provide: CampaignsService, useValue: campaignsService },
        {
          provide: CampaignTrackingService,
          useValue: campaignTrackingService,
        },
        {
          provide: CampaignSchoolsService,
          useValue: {},
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => app.close());

  beforeEach(() => jest.clearAllMocks());

  it('allows an administrator to consult summary and paginated tracking', async () => {
    await request(httpServer)
      .get(`/api/admin/campaigns/${campaignId}/tracking/summary`)
      .set('x-test-role', UserRole.Admin)
      .expect(200, { totalSchools: 0 });
    await request(httpServer)
      .get(
        `/api/admin/campaigns/${campaignId}/tracking?status=draft&page=1&limit=20`,
      )
      .set('x-test-role', UserRole.Admin)
      .expect(200);

    expect(campaignTrackingService.summary).toHaveBeenCalledWith(campaignId);
    expect(campaignTrackingService.list).toHaveBeenCalledWith(
      campaignId,
      expect.objectContaining({
        status: 'draft',
        page: 1,
        limit: 20,
      }),
    );
  });

  it('rejects school sessions and unauthenticated requests', async () => {
    await request(httpServer)
      .get(`/api/admin/campaigns/${campaignId}/tracking/summary`)
      .set('x-test-role', UserRole.School)
      .expect(403);
    await request(httpServer)
      .get(`/api/admin/campaigns/${campaignId}/tracking`)
      .expect(401);

    expect(campaignTrackingService.summary).not.toHaveBeenCalled();
    expect(campaignTrackingService.list).not.toHaveBeenCalled();
  });

  it('rejects invalid filters and pagination before reaching the service', async () => {
    await request(httpServer)
      .get(
        `/api/admin/campaigns/${campaignId}/tracking?status=certified&page=0`,
      )
      .set('x-test-role', UserRole.Admin)
      .expect(400);

    expect(campaignTrackingService.list).not.toHaveBeenCalled();
  });
});

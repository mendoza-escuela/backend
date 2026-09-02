import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { PassThrough } from 'node:stream';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.type';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { UserSchool } from '../../users/entities/user-school.entity';
import { IndividualReportService } from '../services/individual-report.service';
import { PdfReportRenderer } from '../services/pdf-report.renderer';
import { XlsxReportRenderer } from '../services/xlsx-report.renderer';
import { SchoolReportsController } from './reports.controller';

@Injectable()
class TestSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: AuthenticatedUser;
    }>();
    const role = httpRequest.headers['x-test-role'];
    if (role !== UserRole.Admin && role !== UserRole.School)
      throw new UnauthorizedException();
    httpRequest.user = {
      id: `${role}-user-id`,
      firstName: 'Usuario',
      lastName: 'Prueba',
      email: `${role}@example.com`,
      role,
      sessionId: 'session-id',
      mustChangePassword:
        httpRequest.headers['x-must-change-password'] === 'true',
      lastLoginAt: null,
    };
    return true;
  }
}

describe('School XLSX report authorization and delivery', () => {
  const campaignId = '1a2aa1a2-d2e8-4f64-aa90-94a954589062';
  const schoolId = '2a2aa1a2-d2e8-4f64-aa90-94a954589062';
  const submissionId = '3a2aa1a2-d2e8-4f64-aa90-94a954589062';
  const associationRepository = {
    findOneBy: jest.fn().mockResolvedValue({ schoolId }),
  };
  const auditRepository = { save: jest.fn().mockResolvedValue({}) };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === UserSchool) return associationRepository;
      if (entity === AuditLog) return auditRepository;
      throw new Error('Repositorio inesperado.');
    }),
  };
  const reports = {
    get: jest.fn().mockResolvedValue({
      school: { cue: '5000000' },
      submission: { id: submissionId },
    }),
  };
  const xlsx = {
    report: jest.fn().mockResolvedValue(Buffer.from('PK-workbook-completo')),
  };
  const pdf = {
    report: jest.fn(() => pdfStream()),
    receipt: jest.fn(() => pdfStream()),
  };
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SchoolReportsController],
      providers: [
        { provide: IndividualReportService, useValue: reports },
        { provide: PdfReportRenderer, useValue: pdf },
        { provide: XlsxReportRenderer, useValue: xlsx },
        { provide: DataSource, useValue: dataSource },
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

  beforeEach(() => {
    jest.clearAllMocks();
    associationRepository.findOneBy.mockResolvedValue({ schoolId });
    reports.get.mockResolvedValue({
      school: { cue: '5000000' },
      submission: { id: submissionId },
    });
    xlsx.report.mockResolvedValue(Buffer.from('PK-workbook-completo'));
  });

  it.each(['report', 'receipt'] as const)(
    'impide cachear la descarga PDF de %s',
    async (kind) => {
      const response = await request(server)
        .get(`/api/school/campaigns/${campaignId}/submission/${kind}.pdf`)
        .set('x-test-role', UserRole.School)
        .buffer(true)
        .parse(binaryParser)
        .expect(200)
        .expect('content-type', 'application/pdf')
        .expect('cache-control', 'private, no-store');

      expect((response.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    },
  );

  it('resuelve la escuela desde la sesión y entrega el XLSX con headers seguros', async () => {
    const response = await request(server)
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .set('x-test-role', UserRole.School)
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect('content-type', XlsxReportRenderer.mimeType)
      .expect(
        'content-disposition',
        'attachment; filename="reporte-5000000.xlsx"',
      )
      .expect('cache-control', 'private, no-store');

    expect((response.body as Buffer).toString()).toBe('PK-workbook-completo');
    expect(associationRepository.findOneBy).toHaveBeenCalledWith({
      userId: `${UserRole.School}-user-id`,
    });
    expect(reports.get).toHaveBeenCalledWith(campaignId, schoolId);
    expect(auditRepository.save).toHaveBeenCalledWith({
      actorUserId: `${UserRole.School}-user-id`,
      action: 'INDIVIDUAL_XLSX_REPORT_DOWNLOADED',
      entityType: 'SurveySubmission',
      entityId: submissionId,
      changes: { campaignId, schoolId, format: 'xlsx' },
    });
  });

  it('rechaza sesiones no autenticadas, administrativas o con clave temporal', async () => {
    await request(server)
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .expect(401);
    await request(server)
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .set('x-test-role', UserRole.Admin)
      .expect(403);
    await request(server)
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .set('x-test-role', UserRole.School)
      .set('x-must-change-password', 'true')
      .expect(403);

    expect(reports.get).not.toHaveBeenCalled();
  });

  it('no consulta reportes si la sesión no tiene una escuela asociada', async () => {
    associationRepository.findOneBy.mockResolvedValueOnce(null);

    await request(server)
      .get(`/api/school/campaigns/${campaignId}/submission/report.xlsx`)
      .set('x-test-role', UserRole.School)
      .expect(404);

    expect(reports.get).not.toHaveBeenCalled();
    expect(auditRepository.save).not.toHaveBeenCalled();
  });

  it('valida el campaignId antes de resolver cualquier dato institucional', async () => {
    await request(server)
      .get('/api/school/campaigns/no-es-uuid/submission/report.xlsx')
      .set('x-test-role', UserRole.School)
      .expect(400);

    expect(associationRepository.findOneBy).not.toHaveBeenCalled();
    expect(reports.get).not.toHaveBeenCalled();
  });
});

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

function pdfStream() {
  const document = new PassThrough();
  document.write(Buffer.from('%PDF-test'));
  return document;
}

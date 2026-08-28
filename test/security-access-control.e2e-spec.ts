/**
 * Pruebas de control de acceso, autenticación y cabeceras de seguridad.
 *
 * Cubren lo que ningún escáner automático puede verificar por sí solo: que la
 * autorización distinga entre usuarios del mismo rol (acceso horizontal) y
 * entre roles distintos (acceso vertical).
 *
 * PRESUPUESTO DE LOGIN: el endpoint /api/auth/login limita a 10 intentos por
 * minuto y por IP. La suite entera comparte esa cuota, así que se autentica una
 * sola vez por rol en beforeAll y los tests reutilizan esos agentes. Los pocos
 * casos que necesitan un login propio están contados, y el test de rate
 * limiting va deliberadamente al final porque agota la cuota restante.
 *
 * Se ejecutan contra una base real. Sin TEST_DATABASE_URL la suite se salta,
 * igual que el resto de los e2e del proyecto.
 *
 *   TEST_DATABASE_URL=postgresql://... npm run test:e2e -- security-access-control
 *
 * Referencias: OWASP ASVS 5.0 V1/V2/V3/V4/V12, OWASP WSTG-ATHZ.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Server } from 'node:http';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { spanishValidationException } from '../src/common/validation/spanish-validation-errors';
import { parseFrontendOrigin } from '../src/config/frontend-origins';
import { School } from '../src/modules/schools/entities/school.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { UserSchool } from '../src/modules/users/entities/user-school.entity';
import { UserRole } from '../src/modules/users/entities/user-role.enum';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const PASSWORD = 'SeguridadE2E#2026';
const ALLOWED_ORIGIN = parseFrontendOrigin(
  process.env.FRONTEND_URL ?? 'http://localhost:5173',
);
const HOSTILE_ORIGIN = 'https://sitio-atacante.example';

function csrfHeaders(): Record<string, string> {
  return { Origin: ALLOWED_ORIGIN, 'X-CSRF-Protection': '1' };
}

describeWithDatabase('Seguridad: control de acceso y autenticación', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;

  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `sec.admin.${suffix}@example.com`;
  const schoolAEmail = `sec.school.a.${suffix}@example.com`;
  const schoolBEmail = `sec.school.b.${suffix}@example.com`;

  let schoolAId = '';
  let schoolBId = '';

  // Agentes autenticados una única vez (3 logins de la cuota).
  let admin: ReturnType<typeof request.agent>;
  let schoolA: ReturnType<typeof request.agent>;
  let adminCookie = '';

  const login = async (email: string) => {
    const agent = request.agent(server).set(csrfHeaders());
    const response = await agent
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { agent, response };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    // Replica el bootstrap de src/main.ts: sin esto la app de prueba no lleva
    // Helmet ni CORS y las cabeceras no se podrian verificar. La comprobacion
    // end-to-end sobre el binario real la hace ZAP contra el entorno efimero.
    app.use(helmet());
    app.enableCors({
      origin: ALLOWED_ORIGIN,
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Protection'],
      exposedHeaders: ['Content-Disposition'],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: spanishValidationException,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;

    dataSource = app.get(DataSource);
    const passwordHash = await bcrypt.hash(PASSWORD, 12);

    const createUser = async (email: string, role: UserRole) => {
      const repository = dataSource.getRepository(User);
      return repository.save(
        repository.create({
          firstName: 'Seguridad',
          lastName: 'E2E',
          email,
          passwordHash,
          role,
          isActive: true,
          mustChangePassword: false,
          lastLoginAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      );
    };

    const createSchool = async (cue: string, name: string) => {
      const repository = dataSource.getRepository(School);
      return repository.save(
        repository.create({
          cue,
          name,
          directorName: 'Director E2E',
          schoolNumber: null,
          department: 'Departamento E2E',
          locality: 'Localidad E2E',
          address: 'Direccion E2E',
          postalCode: null,
          educationLevel: 'Primaria',
          managementType: 'Estatal',
          scope: 'Urbano',
          shift: 'Mañana',
          shiftCatalogId: null,
          phone: null,
          email: null,
          referentFirstName: 'Referente',
          referentLastName: 'E2E',
          referentEmail: null,
          referentPhone: null,
          enrollment: 50,
          hasKiosk: false,
          hasFoodService: false,
          isBoarding: false,
          characteristics: {},
          isActive: true,
        }),
      );
    };

    await createUser(adminEmail, UserRole.Admin);
    const schoolUserA = await createUser(schoolAEmail, UserRole.School);
    const schoolUserB = await createUser(schoolBEmail, UserRole.School);

    const createdSchoolA = await createSchool(`991${suffix}`, 'Escuela E2E A');
    const createdSchoolB = await createSchool(`992${suffix}`, 'Escuela E2E B');
    schoolAId = createdSchoolA.id;
    schoolBId = createdSchoolB.id;

    const userSchools = dataSource.getRepository(UserSchool);
    await userSchools.save(
      userSchools.create({
        userId: schoolUserA.id,
        schoolId: createdSchoolA.id,
      }),
    );
    await userSchools.save(
      userSchools.create({
        userId: schoolUserB.id,
        schoolId: createdSchoolB.id,
      }),
    );

    // --- Logins 1 y 2 de la cuota ---
    const adminLogin = await login(adminEmail);
    admin = adminLogin.agent;
    const setCookie = adminLogin.response.headers[
      'set-cookie'
    ] as unknown as string[];
    adminCookie = setCookie.find((c) => c.startsWith('access_token=')) ?? '';

    schoolA = (await login(schoolAEmail)).agent;
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource
        .getRepository(User)
        .createQueryBuilder()
        .delete()
        .where('email IN (:...emails)', {
          emails: [adminEmail, schoolAEmail, schoolBEmail],
        })
        .execute();
      await dataSource
        .getRepository(School)
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids: [schoolAId, schoolBId] })
        .execute();
    }
    await app?.close();
  });

  /** Petición autenticada con la cookie del admin pero sin cabeceras por defecto. */
  const rawAdminRequest = (
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
  ) => request(server)[method](path).set('Cookie', adminCookie);

  // ---------------------------------------------------------------------------
  describe('Autenticación', () => {
    it('rechaza el acceso sin token', async () => {
      await request(server).get('/api/auth/me').expect(401);
      await request(server).get('/api/admin/schools').expect(401);
    });

    it('rechaza un JWT con formato inválido', async () => {
      await request(server)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer no-es-un-token')
        .expect(401);
    });

    it('rechaza un JWT con la firma alterada', async () => {
      const token = adminCookie.split('=')[1]?.split(';')[0] ?? '';
      expect(token).not.toEqual('');

      const [header, payload, signature] = token.split('.');
      const tampered = signature.split('').reverse().join('');
      await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${header}.${payload}.${tampered}`)
        .expect(401);
    });

    it('rechaza un JWT firmado con el algoritmo "none"', async () => {
      // Verifica la lista blanca de algoritmos incorporada por el hallazgo H-01.
      const base64url = (value: object) =>
        Buffer.from(JSON.stringify(value))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      const forged = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
        sub: randomUUID(),
        sid: randomUUID(),
      })}.`;

      await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('rechaza un JWT bien firmado cuya sesión no existe', async () => {
      // La sesión se valida contra la base en cada petición: un token con
      // firma válida pero sid desconocido no sirve.
      const token = adminCookie.split('=')[1]?.split(';')[0] ?? '';
      const [header, , signature] = token.split('.');
      const base64url = (value: object) =>
        Buffer.from(JSON.stringify(value))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      const otherSession = `${header}.${base64url({
        sub: randomUUID(),
        sid: randomUUID(),
      })}.${signature}`;

      await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${otherSession}`)
        .expect(401);
    });

    it('la cookie de sesión se emite con httpOnly y SameSite', () => {
      // Control compensatorio de la excepción SEC-EXC-003: Semgrep no puede ver
      // dentro del spread de cookieOptions(), este test sí.
      expect(adminCookie).toMatch(/HttpOnly/i);
      expect(adminCookie).toMatch(/SameSite=/i);
      expect(adminCookie).toMatch(/Path=\//i);
    });

    it('invalida la sesión después del logout', async () => {
      // --- Login 3 de la cuota: sesión desechable para no perder la del admin ---
      const { agent } = await login(adminEmail);
      await agent.get('/api/auth/me').expect(200);
      await agent.post('/api/auth/logout').expect(204);
      await agent.get('/api/auth/me').expect(401);
    });

    it('no revela si una cuenta existe', async () => {
      // Hallazgo H-06: ambos mensajes deben ser idénticos.
      // --- Intentos 4 y 5 de la cuota (fallidos) ---
      const inexistente = await request(server)
        .post('/api/auth/login')
        .set(csrfHeaders())
        .send({ email: `noexiste.${suffix}@example.com`, password: PASSWORD })
        .expect(401);
      const claveIncorrecta = await request(server)
        .post('/api/auth/login')
        .set(csrfHeaders())
        .send({ email: adminEmail, password: 'ClaveIncorrecta#2026' })
        .expect(401);

      expect((inexistente.body as { message: string }).message).toEqual(
        (claveIncorrecta.body as { message: string }).message,
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('Escalación vertical', () => {
    it('un usuario escuela no accede a endpoints administrativos', async () => {
      await schoolA.get('/api/admin/schools').expect(403);
      await schoolA.get('/api/admin/users').expect(403);
      await schoolA.get('/api/admin/campaigns').expect(403);
    });

    it('un administrador no accede al portal de escuelas', async () => {
      await admin.get('/api/school/campaigns').expect(403);
    });

    it('un usuario escuela no puede crear usuarios', async () => {
      await schoolA
        .post('/api/admin/users')
        .send({
          firstName: 'Intruso',
          lastName: 'Escalado',
          email: `intruso.${suffix}@example.com`,
          role: 'admin',
        })
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Escalación horizontal / IDOR', () => {
    it('una escuela no lee recursos de otra escuela cambiando el id en la URL', async () => {
      const response = await schoolA.get(
        `/api/school/schools/${schoolBId}/profile`,
      );
      expect(response.status).not.toEqual(200);
      expect([400, 403, 404]).toContain(response.status);
    });

    it('una escuela no modifica recursos de otra escuela', async () => {
      const response = await schoolA
        .patch(`/api/school/schools/${schoolBId}/profile`)
        .send({ referentPhone: '2610000000' });
      expect(response.status).not.toEqual(200);
    });

    it('un id inexistente nunca devuelve 200', async () => {
      const response = await schoolA.get(
        `/api/school/schools/${randomUUID()}/profile`,
      );
      expect(response.status).not.toEqual(200);
    });

    it('un id malformado se rechaza sin error de servidor', async () => {
      const response = await schoolA.get(
        '/api/school/schools/no-es-un-uuid/profile',
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Protección CSRF', () => {
    it('acepta la mutación con cabecera y origen válidos', async () => {
      const response = await admin
        .post('/api/admin/schools')
        .send({ cue: 'datos-incompletos' });
      // Se rechaza por validación de datos, no por CSRF.
      expect(response.status).not.toEqual(403);
    });

    it('rechaza la mutación sin la cabecera anti-CSRF', async () => {
      await rawAdminRequest('post', '/api/admin/schools')
        .set('Origin', ALLOWED_ORIGIN)
        .send({ name: 'Sin cabecera' })
        .expect(403);
    });

    it('rechaza la mutación con un origen ajeno', async () => {
      await rawAdminRequest('post', '/api/admin/schools')
        .set('Origin', HOSTILE_ORIGIN)
        .set('X-CSRF-Protection', '1')
        .send({ name: 'Origen ajeno' })
        .expect(403);
    });

    it('rechaza la mutación sin Origin ni Referer', async () => {
      // Hallazgo H-02: antes bastaba la cabecera personalizada.
      await rawAdminRequest('post', '/api/admin/schools')
        .set('X-CSRF-Protection', '1')
        .send({ name: 'Sin origen' })
        .expect(403);
    });

    it('acepta la mutación con Referer del origen autorizado', async () => {
      const response = await rawAdminRequest('post', '/api/admin/schools')
        .set('X-CSRF-Protection', '1')
        .set('Referer', `${ALLOWED_ORIGIN}/admin/escuelas`)
        .send({ cue: 'datos-incompletos' });
      expect(response.status).not.toEqual(403);
    });

    it('protege todos los métodos mutadores', async () => {
      // Rutas que existen de verdad en admin-schools.controller.ts: una ruta
      // inexistente devuelve 404 antes de llegar al guard y no probaría nada.
      const identifier = randomUUID();
      const routes: Array<['post' | 'patch' | 'put', string]> = [
        ['post', '/api/admin/schools'],
        ['patch', `/api/admin/schools/${identifier}`],
        ['patch', `/api/admin/schools/${identifier}/status`],
        ['put', `/api/admin/schools/${identifier}/rectification`],
      ];

      for (const [method, path] of routes) {
        const response = await rawAdminRequest(method, path)
          .set('Origin', HOSTILE_ORIGIN)
          .set('X-CSRF-Protection', '1');
        expect(response.status).toEqual(403);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('CORS', () => {
    it('no refleja un origen arbitrario', async () => {
      const response = await request(server)
        .get('/api/health')
        .set('Origin', HOSTILE_ORIGIN);
      expect(response.headers['access-control-allow-origin']).not.toEqual(
        HOSTILE_ORIGIN,
      );
    });

    it('nunca combina comodín con credenciales', async () => {
      const response = await request(server)
        .get('/api/health')
        .set('Origin', ALLOWED_ORIGIN);
      if (response.headers['access-control-allow-credentials'] === 'true') {
        expect(response.headers['access-control-allow-origin']).not.toEqual(
          '*',
        );
      }
    });

    it('el preflight no autoriza un origen ajeno', async () => {
      const response = await request(server)
        .options('/api/admin/schools')
        .set('Origin', HOSTILE_ORIGIN)
        .set('Access-Control-Request-Method', 'POST');
      expect(response.headers['access-control-allow-origin']).not.toEqual(
        HOSTILE_ORIGIN,
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe('Cabeceras de seguridad', () => {
    it('entrega las cabeceras que Helmet debe emitir', async () => {
      const response = await request(server).get('/api/health').expect(200);

      expect(response.headers['x-content-type-options']).toEqual('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['referrer-policy']).toBeDefined();
      // Helmet elimina la cabecera que revela la tecnología del servidor.
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  describe('Validación de entrada', () => {
    it('rechaza propiedades no declaradas en el DTO (mass assignment)', async () => {
      const response = await admin.post('/api/admin/users').send({
        firstName: 'Prueba',
        lastName: 'Inyectada',
        email: `mass.${suffix}@example.com`,
        role: 'school',
        propiedadInexistente: 'valor',
      });
      expect(response.status).toEqual(400);
    });

    it('trata la carga de inyección SQL como texto literal', async () => {
      const response = await admin.get(
        `/api/admin/schools?search=${encodeURIComponent(
          "'; DROP TABLE schools;--",
        )}`,
      );
      expect(response.status).toBeLessThan(500);

      // La tabla debe seguir existiendo.
      const count = await dataSource.getRepository(School).count();
      expect(count).toBeGreaterThan(0);
    });

    it('rechaza un ordenamiento fuera del enum sin error de servidor', async () => {
      const response = await admin.get(
        '/api/admin/schools?sortBy=name);DROP%20TABLE%20schools;--',
      );
      expect(response.status).toBeLessThan(500);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Carga de archivos', () => {
    it('rechaza un ejecutable disfrazado de planilla', async () => {
      const response = await admin
        .post('/api/admin/schools/import/preview')
        .attach('file', Buffer.from('MZ binario'), {
          filename: 'malicioso.exe',
          contentType: 'application/x-msdownload',
        });
      expect(response.status).toEqual(400);
    });

    it('rechaza una doble extensión', async () => {
      const response = await admin
        .post('/api/admin/schools/import/preview')
        .attach('file', Buffer.from('contenido'), {
          filename: 'planilla.xlsx.exe',
          contentType: 'application/vnd.ms-excel',
        });
      expect(response.status).toEqual(400);
    });

    it('rechaza un nombre con recorrido de rutas', async () => {
      const response = await admin
        .post('/api/admin/schools/import/preview')
        .attach('file', Buffer.from('contenido'), {
          filename: '../../etc/passwd.csv',
          contentType: 'text/csv',
        });
      expect(response.status).toEqual(400);
    });

    it('rechaza un archivo que supera el límite de tamaño', async () => {
      const response = await admin
        .post('/api/admin/schools/import/preview')
        .attach('file', Buffer.alloc(3 * 1024 * 1024, 'a'), {
          filename: 'grande.csv',
          contentType: 'text/csv',
        });
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ---------------------------------------------------------------------------
  // Va último a propósito: agota la cuota de login compartida por la suite.
  // ---------------------------------------------------------------------------
  describe('Rate limiting', () => {
    it('limita los intentos de login', async () => {
      // El endpoint declara 10 intentos por minuto y por IP. No es una prueba
      // de carga: son peticiones secuenciales con una cuenta inexistente.
      const email = `ratelimit.${suffix}@example.com`;
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await request(server)
          .post('/api/auth/login')
          .set(csrfHeaders())
          .send({ email, password: 'ClaveIncorrecta#2026' });
        statuses.push(response.status);
      }
      expect(statuses).toContain(429);
    }, 120_000);
  });
});

# Análisis de seguridad del repositorio

**Fase 1 — Inventario previo a cualquier modificación.**
Documento generado por inspección directa del código. Cada afirmación indica el
archivo y la línea que la respalda. Lo que no pudo verificarse se marca
explícitamente como `NOT_EXECUTED` o `REQUIERE_VALIDACION`.

| Campo | Valor |
| --- | --- |
| Fecha del análisis | 2026-08-28 |
| Commit backend | `12bc787` (rama `develop`) |
| Commit frontend | `62e5ac2` (rama `develop`) |
| Alcance | Código fuente de ambos repositorios, sin ejecución de scanners |
| Referencia | OWASP ASVS 5.0 Level 2 |

---

## 1. Estructura real del repositorio

**Hallazgo estructural más importante: no existe un monorepo.** Son dos
repositorios Git independientes, cada uno con su propio historial y remoto:

```
mendoza/                        (carpeta de trabajo, SIN control de versiones)
├── AGENTS.md                   convenciones del proyecto
├── frontend.zip                artefacto suelto (11 MB) — ver hallazgo E-03
├── backend/                    repo git → github.com/mendoza-escuela/backend.git   (develop)
└── frontend/                   repo git → github.com/mendoza-escuela/frontend.git  (develop)
```

Consecuencias directas para el pipeline de seguridad:

- `.github/workflows/` no puede vivir en un único lugar: cada repositorio
  dispara sus propios workflows.
- El entorno DAST necesita **ambos** repositorios simultáneamente, lo que exige
  un checkout cruzado en CI (y por lo tanto, saber si los repos son públicos o
  privados).
- Gitleaks debe recorrer **dos historiales** distintos.
- La estructura `security/` solicitada asume un monorepo y debe adaptarse.

Esta decisión está pendiente de definición y bloquea la Fase 2.

### Backend (`backend/`)

```
src/
├── main.ts                     bootstrap: prefijo /api, Helmet, CORS, ValidationPipe
├── app.module.ts               guards globales (Throttler, CSRF), 14 módulos
├── common/
│   ├── decorators/roles.decorator.ts
│   ├── filters/throttler-exception.filter.ts
│   ├── guards/                 csrf-protection · roles · school-access · password-change-required
│   ├── transforms/ types/ validation/
├── config/                     env.validation.ts · frontend-origins.ts
├── database/                   data-source.ts · typeorm.config.ts · seeds/
├── migrations/                 26 migraciones versionadas
└── modules/                    audit campaigns dashboard evaluation evaluation-config
                                exports health mail reports schools submissions surveys users auth
test/                           5 suites e2e + jest-e2e.json
scripts/                        start-production.cjs · generate-full-questionnaire-workbook.cjs
assets/                         logos institucionales para los PDF
```

### Frontend (`frontend/`)

```
src/
├── lib/          api.ts (cliente axios) · safe-navigation.ts · validation.ts · download.ts
├── hooks/        AuthProvider.tsx · auth-context.ts · useAuth.ts
├── services/     17 servicios por dominio
├── components/   auth dashboard errors layout results schools surveys ui users
├── pages/ routes/ theme/ types/ utils/
public/           brand/ favicon.svg icons.svg
```

---

## 2. Inventario solicitado

### 2.1 Contenedores y orquestación

| Elemento | Estado | Ubicación |
| --- | --- | --- |
| Dockerfile backend | Existe | `backend/Dockerfile` — multi-stage (base→deps→build→prod-deps→runner), `USER node`, `NODE_ENV=production`, `EXPOSE 4000` |
| Dockerfile frontend | Existe | `frontend/Dockerfile` — multi-stage Node→nginx, **corre como root** (ver H-07) |
| `.dockerignore` | Existen ambos | Excluyen `node_modules`, `dist`, `.env`, `.env.*`, logs |
| Compose | **Sólo PostgreSQL** | `backend/docker-compose.yml` — levanta Postgres para desarrollo y **publica el puerto 5432** (aceptable en local, ver H-08) |
| Compose de producción | **No existe** | Ver hallazgo E-01 |
| Reverse proxy | Config mínima | `frontend/nginx.conf` — sirve la SPA, sin cabeceras de seguridad |
| Imágenes base | Versionadas | `node:22-alpine`, `nginx:1.29-alpine`, `postgres:17-alpine`. **Ningún `latest`** |

### 2.2 Lockfiles

| Archivo | Formato |
| --- | --- |
| `backend/package-lock.json` | lockfileVersion 3 |
| `frontend/package-lock.json` | lockfileVersion 3 |

Ambos presentes y consistentes: `npm ci` funciona en los dos proyectos
(verificado durante el build de contenedores).

### 2.3 Base de datos y TypeORM

- Configuración: `backend/src/database/typeorm.config.ts` y `data-source.ts`.
- Admite `DATABASE_URL` o variables separadas (`DATABASE_HOST/PORT/USER/PASSWORD/NAME`).
- **`synchronize: false`** en ambos archivos — correcto, sin generación automática de esquema.
- **26 migraciones** versionadas en `src/migrations/`.
- Inicialización: `npm run start:prod` → `scripts/start-production.cjs` ejecuta
  las migraciones **antes** de arrancar la API, protegidas por
  `pg_advisory_lock(748330021)` para evitar carreras entre réplicas. Si la
  migración falla, el proceso termina con código 1 y la API no arranca.
- Extensión `pgcrypto` creada en la primera migración.

### 2.4 Configuración de seguridad HTTP

| Control | Implementación | Archivo |
| --- | --- | --- |
| Prefijo global | `/api` | `main.ts:22` |
| Helmet | `app.use(helmet())` — configuración por defecto | `main.ts:23` |
| CORS | Origen único derivado de `FRONTEND_URL`, `credentials: true`, allowlist de headers | `main.ts:24-31` |
| Normalización de origen | Rechaza rutas, credenciales, query y fragmentos; exige http/https | `config/frontend-origins.ts` |
| ValidationPipe | `whitelist`, `forbidNonWhitelisted`, `transform`, mensajes en español | `main.ts:32-39` |
| Throttler global | 300 req / 60 s | `app.module.ts:29-34` |
| Trust proxy | Configurable por `TRUST_PROXY_HOPS`, sólo se aplica si es mayor que 0 | `main.ts:13-20` |

**CORS no usa wildcard ni refleja el `Origin`**: `parseFrontendOrigin` devuelve
un origen único y exacto. No hay configuración distinta entre desarrollo y
producción más allá del valor de la variable.

### 2.5 Autenticación JWT — transporte y almacenamiento

Este punto es central para decidir el modelo de amenazas.

| Aspecto | Detalle |
| --- | --- |
| Emisión | `@nestjs/jwt`, payload con `sub`, `sid`, `email`, `role` — `auth.service.ts:112-117` |
| Algoritmo | **No se declara explícitamente** → HS256 por defecto (ver H-01) |
| Expiración | `JWT_EXPIRES_IN` (8 h por defecto) más el `expiresAt` de la sesión |
| Secreto | `JWT_SECRET`, obligatorio, validado al arrancar (`env.validation.ts:5-9`) |
| **Transporte principal** | **Cookie `access_token`** — `httpOnly: true`, `secure` en producción, `sameSite: none`, `partitioned: true`, `path: /` — `auth.controller.ts:107-125` |
| Transporte alternativo | `Authorization: Bearer` aceptado como fallback — `jwt.strategy.ts:12-20` |
| Almacenamiento en frontend | **Ninguno.** Cero usos de `localStorage`/`sessionStorage` en todo `frontend/src`. El navegador gestiona la cookie |
| Cliente HTTP | `axios` con `withCredentials: true` — `frontend/src/lib/api.ts:25-28` |
| Validación por request | `validateSession()` consulta `auth_sessions` en cada petición: `revokedAt IS NULL` y `expiresAt > now()` — `auth.service.ts:132-153` |
| Revocación | Real: logout marca `revokedAt`; la pérdida de asignación escolar revoca la sesión en caliente |
| Refresh token | **No existe.** Sesión única de 8 h |

**Conclusión:** el JWT viaja en cookie `httpOnly`, no accesible por JavaScript.
Esto neutraliza el robo de token por XSS, pero **habilita CSRF**, por lo que la
protección anti-CSRF es arquitectónicamente necesaria (ver 2.6).

### 2.6 Protección CSRF

Implementación propia en `common/guards/csrf-protection.guard.ts`:

1. Métodos seguros (`GET`, `HEAD`, `OPTIONS`) pasan sin verificación.
2. Peticiones con `Authorization: Bearer` **y sin cookie** se consideran no
   vulnerables y pasan (correcto: el navegador no adjunta ese header solo).
3. El resto exige la cabecera `X-CSRF-Protection: 1`.
4. Si hay cabecera `Origin`, debe coincidir **exactamente** con `FRONTEND_URL`.

El frontend la envía automáticamente en todo método mutador —
`frontend/src/lib/api.ts:121-127`.

**Es un patrón de doble validación (cabecera personalizada + origen), no de
token sincronizador.** No hay token por sesión ni rotación. Su solidez depende
de que el navegador exija preflight para cabeceras personalizadas cross-origin,
lo cual es correcto, pero deja un caso abierto: **si `Origin` está ausente, la
petición pasa sólo con la cabecera** (`guard:53-56`). Ver H-02.

### 2.7 Endpoints de autenticación

| Método | Ruta | Protección | Rate limit propio |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | Pública | 10 / 60 s |
| POST | `/api/auth/forgot-password` | Pública | 3 / 15 min |
| POST | `/api/auth/reset-password` | Pública | 5 / 15 min |
| POST | `/api/auth/logout` | `JwtAuthGuard` | global |
| GET | `/api/auth/me` | `JwtAuthGuard` | global |
| POST | `/api/auth/change-password` | `JwtAuthGuard` | 5 / 15 min |

### 2.8 Roles, permisos y control de acceso

Roles reales (`modules/users/entities/user-role.enum.ts`): **`admin`** y
**`school`**. No hay más.

Auditoría completa de los 18 controladores:

| Controlador | Guards | Rol |
| --- | --- | --- |
| `auth.controller` | por método | mixto (público / autenticado) |
| `health.controller` | **ninguno** | público (intencional) |
| `admin-campaigns` · `admin-dashboard` · `admin-results-dashboard` · `admin-evaluation-configurations` · `admin-evaluation-data-quality` · `admin-school-result-detail` · `admin-exports` · `admin-schools` · `admin-surveys` · `admin-users` | `JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard` | `@Roles(Admin)` |
| `school-results-dashboard` · `school-evaluation-results` · `reports` · `school-portal` · `school-submissions` | `JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard` | `@Roles(School)` |
| `surveys` | idem | `@Roles(Admin, School)` |

**No se encontró ningún controlador de negocio sin guards.**

Defensa anti-IDOR: `SchoolAccessGuard` valida la asociación `user_schools`
antes de servir recursos de un establecimiento; los `admin` la saltan por
diseño (`school-access.guard.ts:24-38`).

### 2.9 Endpoints públicos (superficie sin autenticación)

- `GET /api/health` → `status`, `uptime`, `timestamp`
- `GET /api/health/database` → `status`, `database`, `latencyMs`, `timestamp`
- `POST /api/auth/login`, `/forgot-password`, `/reset-password`

Ninguno filtra información sensible. `health/database` expone latencia, lo que
es aceptable pero conviene restringir en producción (ver H-09).

### 2.10 Carga de archivos

Seis endpoints con `FileInterceptor`, todos en memoria (`multer` 2.x forzado por
`overrides`):

| Controlador | Límite | Filtro de tipo |
| --- | --- | --- |
| `admin-schools` (2 endpoints) | 2 MB, 1 archivo | **No** |
| `admin-users` (2 endpoints) | 2 MB, 1 archivo | **No** |
| `admin-surveys` (2 endpoints) | `SURVEY_IMPORT_MAX_FILE_MB` (5 MB), 1 archivo | **No** |

No hay escritura a disco: los archivos se parsean en memoria y se descartan, lo
que **elimina de raíz** path traversal, sobreescritura y doble extensión. El
riesgo remanente es de consumo de recursos y de contenido malicioso al parsear
(ver H-04).

### 2.11 Correo (Nodemailer)

- `modules/mail/services/mail.service.ts`.
- Transporter sólo si `SMTP_HOST`, `SMTP_USER` y `SMTP_PASSWORD` están
  definidos; si no, `isConfigured()` devuelve `false` y la funcionalidad se
  degrada de forma controlada.
- `secure` se activa sólo cuando el puerto es 465. **No se fuerza
  `requireTLS`** en el puerto 587 (H-05).
- Escape HTML propio (`escapeHtml`) aplicado a todos los campos interpolados.
- El destinatario nunca proviene de input libre: sale de `user.email` de la base.
- La contraseña temporal se envía por correo (con cambio obligatorio al primer
  ingreso) — decisión de diseño a documentar ante Ciberseguridad.

### 2.12 Exportación Excel / PDF

- ExcelJS en `modules/exports/`, pdfmake en `modules/reports/`.
- Los datos exportados provienen de la base (nombres de escuelas, respuestas).
- **No hay sanitización de fórmulas** (`=`, `+`, `-`, `@` al inicio de celda):
  ver H-03, confirmado por búsqueda exhaustiva.

### 2.13 SQL — análisis de inyección

17 archivos usan `createQueryBuilder`. Se auditaron todos los puntos donde hay
interpolación de cadena dentro de cláusulas SQL:

| Ubicación | Patrón | Veredicto |
| --- | --- | --- |
| `schools.service.ts:1143` | interpolación de nombre de columna en `andWhere` | **Seguro** — la clave itera sobre un array literal `as const` de 6 columnas |
| `schools.service.ts:1164-1166` | columna interpolada en `where`/`orderBy` | **Seguro** — parámetro tipado como unión literal de 6 valores |
| `dashboard-query-filters.ts:84` | columna y parámetro interpolados | **Seguro** — ambos son literales del propio archivo |
| `participation-dashboard.service.ts:265-267` | columna interpolada | **Seguro** — mismo patrón de unión literal |
| `campaign-schools.service.ts:379` | columna interpolada | **Seguro** — mapa de columnas definido en código |
| `campaign-tracking.service.ts:274-296` | `orderBy` dinámico | **Seguro** — la dirección sale de un ternario que sólo produce `ASC`/`DESC`; el campo es un enum validado por DTO comparado con `if/else` |

**Los valores siempre van parametrizados.** Lo que se interpola son
identificadores de columna de origen estático. No se detectó inyección SQL.

> Nota operativa: Semgrep marcará varios de estos puntos como falsos positivos.
> Deben documentarse como excepción justificada, no suprimirse en silencio.

Único SQL crudo fuera de migraciones: `SELECT 1` (health) y
`SELECT pg_advisory_lock($1)` (parametrizado).

### 2.14 Variables de entorno

**Secretas (nunca al cliente, nunca a Git):**
`JWT_SECRET`, `DATABASE_PASSWORD` / `POSTGRES_PASSWORD`, `DATABASE_URL`,
`SMTP_PASSWORD`, `SMTP_USER`, `INITIAL_ADMIN_PASSWORD`.

**Validación al arranque** (`config/env.validation.ts`): exige `JWT_SECRET`,
`JWT_EXPIRES_IN`, `FRONTEND_URL` y el bloque de base de datos; valida que los
numéricos sean enteros positivos y que **la configuración SMTP esté completa o
totalmente vacía** (evita estados a medias).

**Variables `VITE_*` — todas terminan en el bundle del cliente:**

| Variable | Contenido | ¿Sensible? |
| --- | --- | --- |
| `VITE_API_URL` | URL de la API | No |
| `VITE_BRAND_*` (8 variables) | Rutas públicas a logos | No |

**Ninguna variable `VITE_*` contiene secretos.** Correcto.

### 2.15 Swagger / OpenAPI

**NO EXISTE.** Cero referencias a `@nestjs/swagger`, `SwaggerModule` u OpenAPI
en todo el backend.

Impacto directo: **ZAP API Scan no puede ejecutarse** sin un contrato. La
alternativa se documentará en `SECURITY_TESTING.md`; no se agregará una
dependencia a producción sin aprobación previa.

### 2.16 Healthchecks

- Aplicación: `GET /api/health` y `/api/health/database` (`modules/health/`).
- Contenedores: **ninguno de los dos Dockerfiles declara `HEALTHCHECK`**.
- Compose existente: healthcheck sólo en PostgreSQL (`pg_isready`).

### 2.17 Tests existentes

| Tipo | Cantidad |
| --- | --- |
| Backend unitarios (`*.spec.ts`) | **75** |
| Backend e2e (`*.e2e-spec.ts`) | **5** |
| Frontend (`*.test.ts` / `*.test.tsx`) | **48** |

Detalle crítico para la Fase 5: los e2e usan
`const describeWithDatabase = databaseUrl ? describe : describe.skip` con
`TEST_DATABASE_URL`. **Si la variable no existe, los tests se saltan en
silencio.** Apuntándola a la base efímera del CI, las 5 suites corren de verdad
— es la vía natural para los tests de IDOR de la Fase 5.

---

## 3. Hallazgos

Severidad según impacto y explotabilidad reales en esta arquitectura.

### Estructurales (bloquean el diseño del pipeline)

| ID | Hallazgo | Impacto |
| --- | --- | --- |
| **E-01** | La carpeta `final/` con el compose de producción, proxy TLS y hardening **ya no existe** en el workspace. El único compose es el de PostgreSQL de desarrollo | Sin él no hay entorno reproducible de referencia; hay que decidir si se recrea o se parte de cero |
| **E-02** | Dos repositorios Git independientes sin monorepo, sin `.github/` en ninguno | Define dónde viven `security/`, los workflows y cómo se hace el checkout cruzado para DAST |
| **E-03** | `frontend.zip` (11 MB) suelto en el workspace, fuera de control de versiones | Posible copia obsoleta con secretos; debe revisarse y eliminarse |

### Técnicos

| ID | Sev. | Hallazgo | Evidencia |
| --- | --- | --- | --- |
| **H-01** | Media | JWT **sin `algorithms` explícito** en la verificación. `passport-jwt` sin lista blanca acepta el algoritmo del header; con secreto HMAC el riesgo de confusión de algoritmo es acotado, pero ASVS exige declararlo | `jwt.strategy.ts:29-33` |
| **H-02** | Media | El guard CSRF **acepta la petición si falta la cabecera `Origin`**, confiando sólo en la cabecera personalizada | `csrf-protection.guard.ts:53-56` |
| **H-03** | Media | **Formula injection** en exportaciones: sin neutralizar `=`, `+`, `-`, `@` al inicio de celda. Un dato cargado por una escuela puede ejecutarse al abrir el Excel | `modules/exports/` |
| **H-04** | Media-baja | Uploads **sin validación de MIME/extensión**; se confía en el parser. Vector real: XLSX muy comprimido (zip bomb) procesado en memoria | 6 endpoints con `FileInterceptor` |
| **H-05** | Baja | SMTP en puerto 587 **sin `requireTLS: true`**: si el servidor no anuncia STARTTLS, nodemailer envía en claro | `mail.service.ts:250-255` |
| **H-06** | Baja | **Enumeración de usuarios**: mensaje distinto para cuenta bloqueada y ausencia de `bcrypt.compare` cuando el usuario no existe (diferencia de tiempo medible) | `auth.service.ts:77-90` |
| **H-07** | Baja | Imagen de frontend **corre como root** (nginx por defecto) | `frontend/Dockerfile` |
| **H-08** | Baja | El compose de desarrollo **publica el 5432** al host | `backend/docker-compose.yml:10-11` |
| **H-09** | Info | `/api/health/database` expone latencia sin autenticación | `health.controller.ts` |
| **H-10** | Info | Cookie con `SameSite=None; Partitioned` pensada para frontend y API en hosts distintos; queda innecesariamente laxa si se despliegan en el mismo origen | `auth.controller.ts:119-123` |
| **H-11** | Info | Sin `HEALTHCHECK` en los Dockerfiles; sin 2FA para cuentas administradoras; la auditoría (`audit_log`) sólo cubre campañas y evaluación, no gestión de usuarios ni logins | varios |

### Controles correctamente implementados (evidencia para ASVS)

- bcrypt cost 12 · política de contraseña de 12 caracteres con complejidad.
- Sesiones con estado en base → revocación real.
- Guards en cascada en el 100 % de los controladores de negocio.
- `SchoolAccessGuard` contra acceso horizontal.
- Token de recuperación: 256 bits, almacenado con SHA-256, uso único con lock
  pesimista, expiración e invalidación de los previos.
- `passwordHash` con `select: false`.
- `whitelist` y `forbidNonWhitelisted` → mass assignment mitigado.
- Cero `dangerouslySetInnerHTML` / `eval` / `new Function` en el frontend.
- Protección contra open redirect (`safe-navigation.ts`).
- Sin secretos en variables `VITE_*`.
- Imágenes base versionadas, sin `latest`.
- `npm audit`: **0 vulnerabilidades** en ambos proyectos (observado durante el
  build de contenedores; se reejecutará formalmente en la Fase 3).

---

## 4. Verificaciones no ejecutadas

| Verificación | Estado | Motivo |
| --- | --- | --- |
| Visibilidad de los repositorios (público / privado) | `NOT_EXECUTED` | `gh` CLI no está instalado en el entorno |
| Disponibilidad de CodeQL / GHAS | `NOT_EXECUTED` | Depende de la visibilidad y del plan de GitHub |
| Ejecución de Semgrep, Trivy, Gitleaks, OSV, ZAP, Nuclei | `NOT_EXECUTED` | Corresponde a las fases 3 a 6 |
| Revisión del contenido de `frontend.zip` | `NOT_EXECUTED` | Requiere confirmación: puede contener credenciales antiguas |
| Auditoría del historial Git en busca de secretos | `NOT_EXECUTED` | Corresponde a la Fase 3 (Gitleaks con `--log-opts`) |

---

## 5. Conclusión de la Fase 1

La aplicación llega a esta revisión **en buen estado de seguridad aplicativa**.
Los controles de autenticación, autorización, validación de entrada y manejo de
SQL están correctamente implementados y son verificables. No se detectó ninguna
vulnerabilidad crítica ni alta por inspección de código.

Las brechas están en el **proceso**, no en el código: no hay pipeline de
seguridad, ni SBOM, ni escaneo de dependencias automatizado, ni evidencia
reproducible — que es exactamente lo que exige una revisión formal.

Los tres hallazgos estructurales (E-01, E-02, E-03) deben resolverse antes de
la Fase 2, porque determinan dónde vive el pipeline y contra qué se ejecuta.

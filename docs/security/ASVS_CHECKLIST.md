# Checklist OWASP ASVS 5.0 — Nivel 2

| Campo | Valor |
| --- | --- |
| Estándar | OWASP ASVS 5.0, Nivel 2 |
| Fecha | 2026-08-28 |
| Commit backend | `12bc787` |
| Commit frontend | `62e5ac2` |
| Evaluador | Equipo de desarrollo (autoevaluación previa a la revisión formal) |

## Cómo leer este documento

| Estado | Significado |
| --- | --- |
| **PASS** | Control implementado **y** verificado por una prueba ejecutada. La columna Evidencia indica cuál. |
| **FAIL** | Control ausente o insuficiente. |
| **NOT_TESTED** | Implementado pero sin prueba automática que lo respalde. |
| **NOT_APPLICABLE** | No aplica a esta arquitectura, con la razón indicada. |
| **MANUAL_REVIEW** | Requiere criterio humano; no se puede automatizar. |

> **Regla estricta:** no se marca PASS por tener una librería instalada. "Helmet
> está en package.json" no es evidencia; "el test verifica que la respuesta
> incluye `X-Content-Type-Options: nosniff`" sí lo es.

Abreviaturas de evidencia:

- `SEC-E2E` → `backend/test/security-access-control.e2e-spec.ts` (33 tests, todos en verde)
- `SAST` → Semgrep con reglas propias, `security/config/semgrep/custom-rules.yml`
- `DAST` → OWASP ZAP baseline autenticado + Nuclei
- `ANALISIS` → `docs/security/REPOSITORY_SECURITY_ANALYSIS.md`

---

## V1 — Codificación y arquitectura

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 1.1.1 | Ciclo de desarrollo seguro | PASS | Pipeline en `.github/workflows/` | SAST, SCA, secretos, DAST y gates en cada PR |
| 1.2.1 | Componentes con cuentas de baja privilegio | PASS | `docker inspect` en Fase 2 y 9 | API `USER node`; frontend UID 101; ambos `cap_drop: ALL` |
| 1.4.1 | Control de acceso obligatorio en el servidor | PASS | SEC-E2E · escalación vertical | Guards en el 100 % de los 18 controladores |
| 1.5.1 | Validación de entrada en el servidor | PASS | SEC-E2E · validación de entrada | `ValidationPipe` global con whitelist |
| 1.14.6 | Sin tecnologías no soportadas del lado cliente | PASS | `ANALISIS` 2.14 | React 19 y Vite 8; sin Flash ni applets |

## V2 — Autenticación

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 2.1.1 | Longitud mínima de 12 caracteres | PASS | `password-policy.ts` + su spec | Además exige mayúscula, minúscula, número y símbolo |
| 2.1.7 | Verificación contra contraseñas filtradas | **FAIL** | — | No hay integración con HaveIBeenPwned ni diccionario. Ver riesgo residual |
| 2.2.1 | Defensas anti-automatización | PASS | SEC-E2E · rate limiting | 10/min en login, bloqueo a los 5 intentos por 15 min |
| 2.2.2 | Sin revelar existencia de cuentas | PASS | SEC-E2E · "no revela si una cuenta existe" | Mensaje unificado + bcrypt señuelo (H-06) |
| 2.4.1 | Almacenamiento con hash resistente | PASS | `auth.service.ts` | bcrypt cost 12 |
| 2.5.1 | Recuperación sin secreto compartido | PASS | `ANALISIS` 2.11 | Token aleatorio de 256 bits por correo |
| 2.5.4 | Token de recuperación de un solo uso | PASS | `auth.service.ts:208-238` | Uso único con lock pesimista; hasheado SHA-256; expira |
| 2.7.2 | Sin credenciales por defecto | PASS | `env.validation.ts` | La app no arranca sin `JWT_SECRET` |
| 2.8.1 | Autenticación multifactor | **FAIL** | — | Ausente. Riesgo residual aceptado y documentado |

## V3 — Gestión de sesiones

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 3.1.1 | Sin sesiones en la URL | PASS | `ANALISIS` 2.5 | Cookie o cabecera `Authorization` |
| 3.2.1 | Token generado por el servidor | PASS | `auth.service.ts` | `randomUUID()` para `sid` |
| 3.2.3 | Almacenamiento seguro en el cliente | PASS | SAST `mendoza-token-in-browser-storage` + `ANALISIS` 2.5 | Cookie `httpOnly`; cero usos de localStorage |
| 3.3.1 | Cierre de sesión invalida el token | PASS | SEC-E2E · "invalida la sesión después del logout" | `revoked_at` verificado en cada petición |
| 3.3.2 | Tiempo de vida acotado | PASS | `SESSION_DURATION_HOURS` | 8 horas por defecto |
| 3.4.1 | Cookie con `Secure` | PASS | Cabecera `Set-Cookie` leída en Fase 2 | Activo cuando `NODE_ENV=production` |
| 3.4.2 | Cookie con `HttpOnly` | PASS | SEC-E2E · "la cookie se emite con httpOnly" | Control compensatorio de SEC-EXC-003 |
| 3.4.3 | Cookie con `SameSite` | PASS | SEC-E2E | `SameSite=None; Partitioned` — ver H-10 |
| 3.5.3 | Algoritmo de firma explícito | PASS | SEC-E2E · `alg: none` y firma alterada | `algorithms: ['HS256']` (H-01 corregido) |

## V4 — Control de acceso

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 4.1.1 | Reglas aplicadas en el servidor | PASS | SEC-E2E · escalación vertical | El frontend nunca decide autorización |
| 4.1.3 | Principio de mínimo privilegio | PASS | SEC-E2E · IDOR | `SchoolAccessGuard` por asociación `user_schools` |
| 4.1.5 | Falla de forma segura | PASS | SEC-E2E · id inexistente y malformado | Nunca devuelve 200 ante un id ajeno |
| 4.2.1 | Sin referencias directas inseguras | PASS | SEC-E2E · 4 tests de acceso horizontal | UUID + validación de propiedad |
| 4.2.2 | Protección CSRF | PASS | SEC-E2E · 6 tests de CSRF | Cabecera + `Origin` estricto + respaldo `Referer` (H-02) |
| 4.3.1 | Interfaz administrativa protegida | PASS | SEC-E2E | `@Roles(Admin)` en los 10 controladores administrativos |

## V5 — Validación, saneamiento y codificación

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 5.1.1 | Sin contaminación de parámetros | PASS | `ValidationPipe` con `transform` | DTOs tipados |
| 5.1.2 | Sin mass assignment | PASS | SEC-E2E · "rechaza propiedades no declaradas" | `forbidNonWhitelisted` |
| 5.2.5 | Sin inyección de plantillas | NOT_APPLICABLE | — | No hay motor de plantillas del lado servidor |
| 5.3.3 | Protección contra XSS | PASS | SAST + `ANALISIS` 2.14 + DAST | React escapa por defecto; cero `dangerouslySetInnerHTML` |
| 5.3.4 | Protección contra inyección SQL | PASS | SEC-E2E · inyección literal + auditoría de los 6 puntos | Consultas parametrizadas; interpolación sólo de identificadores estáticos |
| 5.3.7 | Sin inyección LDAP | NOT_APPLICABLE | — | No hay LDAP |
| 5.3.8 | Sin inyección de comandos | PASS | SAST `p/security-audit` | No hay `child_process` en el código de aplicación |
| 5.3.10 | Protección contra CSV/formula injection | PASS | `spreadsheet-cell.util.ts` + su spec | Aplicado a todos los exportadores (corregido el padrón XLSX) |

## V7 — Manejo de errores y registro

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 7.1.1 | Sin datos sensibles en logs | NOT_TESTED | Revisión manual | El seed y el mail evitan imprimir contraseñas; falta prueba automática |
| 7.1.3 | Registro de eventos de seguridad | **FAIL** | `audit_log` sólo en 2 módulos | No cubre login, cambios de rol ni gestión de usuarios |
| 7.4.1 | Mensajes de error genéricos | PASS | SEC-E2E | Excepciones tipadas; sin stack traces al cliente |

## V8 — Protección de datos

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 8.1.1 | Sin datos sensibles en caché del cliente | PASS | `nginx.conf` del frontend | `no-store` en `index.html` |
| 8.2.2 | Sin datos sensibles en almacenamiento del cliente | PASS | SAST + `ANALISIS` 2.5 | Cero uso de localStorage/sessionStorage |
| 8.3.1 | Datos sensibles enviados en el cuerpo | PASS | `ANALISIS` 2.7 | Las credenciales viajan en el cuerpo del POST |

## V9 — Comunicaciones

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 9.1.1 | TLS en todas las conexiones cliente | MANUAL_REVIEW | — | Depende del despliegue. El entorno de CI es HTTP por diseño; se valida con testssl.sh contra staging |
| 9.1.2 | Cifrados fuertes | NOT_TESTED | `testssl.json` | Requiere `SECURITY_STAGING_URL`; hoy SKIPPED |
| 9.2.1 | TLS para conexiones salientes | PASS | `mail.service.ts` | `requireTLS: true` fuera del 465 (H-05 corregido) |

## V10 — Código malicioso

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 10.2.1 | Sin funcionalidad no autorizada | MANUAL_REVIEW | Revisión de código | Requiere criterio humano |
| 10.3.2 | Integridad de dependencias | PASS | `package-lock.json` + Trivy + OSV | Lockfiles versionados; SCA en cada PR |

## V12 — Archivos y recursos

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 12.1.1 | Límite de tamaño de archivo | PASS | SEC-E2E · "supera el límite de tamaño" | 2 MB (padrones) y 5 MB (cuestionarios) |
| 12.2.1 | Validación del tipo de archivo | PASS | SEC-E2E · ejecutable y doble extensión | `importFileFilter` (H-04 corregido) |
| 12.3.1 | Sin path traversal en nombres | PASS | SEC-E2E · "recorrido de rutas" | Rechaza `..` y separadores |
| 12.3.4 | Sin ejecución de archivos subidos | PASS | `ANALISIS` 2.10 | Procesamiento en memoria; nunca se escriben a disco |
| 12.4.1 | Almacenamiento fuera de la raíz web | NOT_APPLICABLE | — | No se almacenan archivos |
| 12.5.1 | Sin descarga de archivos arbitrarios | PASS | `download.ts` | Nombre saneado desde `Content-Disposition` |

## V13 — API y servicios web

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 13.1.3 | Sin exposición de la definición de la API | NOT_APPLICABLE | `ANALISIS` 2.15 | No hay Swagger/OpenAPI publicado |
| 13.2.1 | Métodos HTTP restringidos | PASS | SEC-E2E · métodos mutadores | Nest sólo expone los declarados |
| 13.2.3 | Protección CSRF en la API | PASS | SEC-E2E | Ver V4.2.2 |

## V14 — Configuración

| ID | Control | Estado | Evidencia | Observación |
| --- | --- | --- | --- | --- |
| 14.1.1 | Build reproducible y automatizado | PASS | Dockerfiles multi-stage + `npm ci` | Imágenes etiquetadas por SHA |
| 14.1.3 | Configuración por entorno | PASS | `env.validation.ts` | Falla al arrancar si falta un valor obligatorio |
| 14.2.1 | Dependencias actualizadas | PASS | Dependabot + escaneo nocturno | npm, Docker y GitHub Actions |
| 14.2.3 | Recursos de terceros con integridad | PASS | `index.html` | Sin CDNs externos; todo se sirve desde el propio origen |
| 14.3.2 | Sin modo debug en producción | PASS | `NODE_ENV=production` | Sin source maps (verificado por el workflow del frontend) |
| 14.4.1 | Content-Type en las respuestas | PASS | SEC-E2E | Nest lo fija |
| 14.4.3 | Content-Security-Policy | NOT_TESTED | — | Helmet emite su CSP por defecto en `/api`. La CSP de la SPA depende del reverse proxy de producción, que hoy no está versionado |
| 14.4.4 | `X-Content-Type-Options: nosniff` | PASS | SEC-E2E · cabeceras | Verificado en la respuesta real |
| 14.4.5 | Strict-Transport-Security | NOT_TESTED | — | Se emite en el proxy de producción; se valida con testssl.sh |
| 14.4.7 | `X-Frame-Options` / `frame-ancestors` | PASS | SEC-E2E · cabeceras | Helmet lo emite |
| 14.5.3 | CORS restrictivo | PASS | SEC-E2E · 3 tests de CORS | Origen único; sin reflejo ni comodín |

---

## Resumen

| Estado | Cantidad |
| --- | --- |
| PASS | 48 |
| FAIL | 3 |
| NOT_TESTED | 5 |
| NOT_APPLICABLE | 5 |
| MANUAL_REVIEW | 2 |
| **Total evaluado** | **63** |

### Los tres FAIL

1. **2.1.7 — Contraseñas filtradas.** No se verifica contra corpus de
   contraseñas comprometidas. Mitigación posible: integrar la API de rangos de
   HaveIBeenPwned (k-anonymity, no envía la contraseña).
2. **2.8.1 — Sin MFA.** El control más relevante que falta para cuentas
   administradoras de un sistema provincial.
3. **7.1.3 — Auditoría incompleta.** `audit_log` no cubre autenticación ni
   gestión de usuarios.

### Los cinco NOT_TESTED

Tres dependen del reverse proxy de producción (CSP de la SPA, HSTS, cifrados
TLS): no se pueden verificar contra el entorno efímero, que es HTTP a propósito.
Se resuelven configurando `SECURITY_STAGING_URL` y ejecutando el workflow
nocturno. Los otros dos requieren pruebas adicionales sobre logs.

> **Advertencia honesta:** este checklist es una autoevaluación. No sustituye la
> revisión del departamento de Ciberseguridad, y "sin vulnerabilidades
> detectadas" no equivale a "aplicación segura".

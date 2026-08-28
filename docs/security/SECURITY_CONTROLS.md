# Catálogo de controles de seguridad

Inventario de cada control implementado, con su ubicación, la prueba que lo
respalda y su estado. Es el documento que responde a "¿cómo sé que esto es
cierto?".

| Campo | Valor |
| --- | --- |
| Fecha | 2026-08-28 |
| Commit backend | `12bc787` |
| Commit frontend | `62e5ac2` |

**Regla:** un control sólo figura como *Verificado* si existe una prueba
ejecutada que lo comprueba. "La librería está instalada" no es verificación.

Evidencia:
- `SEC-E2E` → `backend/test/security-access-control.e2e-spec.ts` (33/33 en verde)
- `SAST` → Semgrep con 11 reglas propias
- `DAST` → ZAP baseline autenticado + Nuclei (5560 plantillas)
- `INSPECT` → `docker inspect` sobre el entorno en ejecución

---

## 1. Autenticación

| Control | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| Hash de contraseñas | bcrypt cost 12 | `auth.service.ts` | Verificado |
| Política de contraseñas | 12 caracteres + 4 clases | `password-policy.ts` + spec | Verificado |
| Bloqueo por intentos | 5 intentos → 15 min | `users.service.ts` | Verificado |
| Rate limit de login | 10/min por IP | SEC-E2E · rate limiting | Verificado |
| Rate limit de recuperación | 3 cada 15 min | `auth.controller.ts:67` | Implementado |
| Sin enumeración de usuarios | Mensaje unificado + bcrypt señuelo | SEC-E2E | Verificado |
| Token de recuperación seguro | 256 bits, SHA-256, uso único, lock pesimista | `auth.service.ts:208-238` | Implementado |
| Cambio obligatorio inicial | `PasswordChangeRequiredGuard` | Guards de los 18 controladores | Implementado |
| **MFA** | — | — | **Ausente** |
| **Contraseñas filtradas** | — | — | **Ausente** |

## 2. Sesiones

| Control | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| Cookie `httpOnly` | `cookieOptions()` | SEC-E2E | Verificado |
| Cookie `Secure` en producción | `NODE_ENV === 'production'` | Cabecera real leída en Fase 2 | Verificado |
| Algoritmo JWT explícito | `algorithms: ['HS256']` | SEC-E2E · `alg: none` rechazado | Verificado |
| Revocación en logout | `revoked_at` | SEC-E2E · logout invalida | Verificado |
| Validación de sesión por petición | `validateSession()` | SEC-E2E · sesión inexistente | Verificado |
| Expiración de sesión | 8 h configurable | `SESSION_DURATION_HOURS` | Implementado |
| Revocación por baja de asignación | Sesión revocada en caliente | `auth.service.ts:144-153` | Implementado |
| Sin token en almacenamiento del navegador | Cero `localStorage` | SAST + análisis | Verificado |

## 3. Autorización

| Control | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| Guards en todos los controladores | 18/18 | SEC-E2E | Verificado |
| Control por rol | `RolesGuard` + `@Roles` | SEC-E2E · 3 tests verticales | Verificado |
| Control por establecimiento | `SchoolAccessGuard` | SEC-E2E · 4 tests horizontales | Verificado |
| Rol desde la base, no del token | `validateSession()` | `auth.service.ts` | Implementado |
| Fallo seguro ante id ajeno | Nunca 200 | SEC-E2E | Verificado |

## 4. Entrada y salida

| Control | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| Validación global | `ValidationPipe` con whitelist | SEC-E2E | Verificado |
| Sin mass assignment | `forbidNonWhitelisted` | SEC-E2E | Verificado |
| Validación de UUID | `ParseUUIDPipe` | SEC-E2E · id malformado | Verificado |
| Consultas parametrizadas | TypeORM | SEC-E2E · carga de inyección | Verificado |
| Sin XSS | React + cero `dangerouslySetInnerHTML` | SAST + DAST | Verificado |
| Sin open redirect | `getSafeInternalPath()` | `safe-navigation.ts` + spec | Implementado |
| Formula injection en planillas | `spreadsheetSafeCell()` | Spec del helper | Verificado |

## 5. Archivos

| Control | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| Límite de tamaño | 2 MB / 5 MB | SEC-E2E | Verificado |
| Un solo archivo por petición | `files: 1` | Interceptores | Implementado |
| Filtro de MIME y extensión | `importFileFilter` | SEC-E2E · ejecutable rechazado | Verificado |
| Rechazo de path traversal | `importFileFilter` | SEC-E2E | Verificado |
| Rechazo de doble extensión | `importFileFilter` | SEC-E2E | Verificado |
| Límite de longitud de nombre | 255 caracteres | `import-file.filter.ts` | Implementado |
| Sin escritura a disco | Procesamiento en memoria | Análisis 2.10 | Verificado |

## 6. Comunicaciones

| Control | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| CORS de origen único | `parseFrontendOrigin()` | SEC-E2E · 3 tests | Verificado |
| Anti-CSRF | Cabecera + `Origin` + `Referer` | SEC-E2E · 6 tests | Verificado |
| Cabeceras de seguridad | Helmet | SEC-E2E · cabeceras reales | Verificado |
| SMTP con TLS obligatorio | `requireTLS` fuera del 465 | `mail.service.ts` | Implementado |
| Escape HTML en correos | `escapeHtml()` | `mail.service.ts` | Implementado |
| **TLS del sitio** | Reverse proxy | — | **Depende del despliegue** |

## 7. Infraestructura

| Control | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| Usuario no-root | `USER node` · UID 101 | INSPECT | Verificado |
| Sistema de archivos de sólo lectura | `read_only: true` | INSPECT | Verificado |
| Sin capacidades de Linux | `cap_drop: ALL` | INSPECT | Verificado |
| `no-new-privileges` | `security_opt` | INSPECT | Verificado |
| Base sin exposición | Red `internal: true` | Fase 2 · conexión rechazada | Verificado |
| Healthchecks | En Dockerfiles y compose | `docker compose ps` | Verificado |
| Imágenes con versión fija | Sin `latest` | Dockerfiles | Verificado |
| Límites de recursos | `deploy.resources.limits` | compose | Implementado |

## 8. Pipeline

| Control | Herramienta | Estado |
| --- | --- | --- |
| SAST | Semgrep 1.145.0 + 11 reglas propias | Verificado |
| SCA | Trivy 0.67.2 + OSV-Scanner v2.2.4 | Verificado |
| Secretos con historial | Gitleaks v8.30.0 | Verificado |
| SBOM CycloneDX | Trivy | Verificado |
| Escaneo de imágenes | Trivy Image por SHA | Verificado |
| DAST | ZAP 2.16.1 + Nuclei v3.4.10 | Verificado |
| TLS | testssl.sh 3.2 | Requiere staging |
| Gestión de excepciones | Validador propio con vencimiento | Verificado |
| Escaneo programado | Workflow nocturno | Implementado |

---

## Brechas reconocidas

| # | Brecha | Impacto | Recomendación |
| --- | --- | --- | --- |
| 1 | **Sin MFA para administradores** | Alto | Segundo factor TOTP para el rol admin |
| 2 | **Auditoría incompleta** | Medio | Registrar login, cambios de rol y ABM de usuarios en `audit_log` |
| 3 | **Sin verificación de contraseñas filtradas** | Medio | HaveIBeenPwned por k-anonymity |
| 4 | **CSP de la SPA no versionada** | Medio | Versionar la configuración del reverse proxy de producción |
| 5 | **Reportes sincrónicos** | Medio | Cola de trabajos si crece el volumen |
| 6 | **Sin protección DDoS de red** | Medio | Corresponde a la infraestructura provincial |
| 7 | **Cookie `SameSite=None`** | Bajo | Pasar a `Lax`/`Strict` si se despliega same-origin |
| 8 | **`/api/health/database` público** | Bajo | Restringir por red o autenticar |

Las brechas 1, 2 y 3 son los tres `FAIL` del checklist ASVS. Las demás son
riesgos residuales aceptados y documentados en `THREAT_MODEL.md`.

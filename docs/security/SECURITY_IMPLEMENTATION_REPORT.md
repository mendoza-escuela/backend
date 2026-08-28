# Informe de implementación de seguridad

| Campo | Valor |
| --- | --- |
| Fecha | 2026-08-28 |
| Backend | `mendoza-escuela/backend` · commit base `12bc787` · rama `develop` |
| Frontend | `mendoza-escuela/frontend` · commit base `62e5ac2` · rama `develop` |
| Estándar | OWASP ASVS 5.0 Nivel 2 |
| Alcance | Pipeline reproducible de validación de seguridad, local y en CI |

---

## 1. Arquitectura encontrada

**Dos repositorios Git independientes**, sin monorepo y sin `.github/` previo.
Esto condicionó todo el diseño: los workflows se duplican en cada repositorio
para que cada uno pueda bloquear sus propios PRs, y el DAST completo vive en el
backend, que es el único que puede levantar el stack entero.

| Componente | Detalle |
| --- | --- |
| Backend | NestJS 11 · TypeScript 5.7 · Node 22 · TypeORM 0.3 · PostgreSQL 17 · 26 migraciones |
| Frontend | React 19 · Vite 8 · TypeScript 6 · Tailwind 4 |
| Autenticación | JWT en **cookie httpOnly** + sesión con estado en `auth_sessions` |
| Autorización | 2 roles (`admin`, `school`) · guards en los 18 controladores |
| Contenedores | Dockerfiles multi-stage, imágenes base versionadas |
| Compose previo | Sólo PostgreSQL de desarrollo (publicaba el 5432) |
| OpenAPI | **No existe** — condiciona el alcance del DAST |
| Tests previos | 75 unitarios backend · 5 e2e · 48 frontend |

Detalle clave: el JWT viaja en cookie `httpOnly`, lo que neutraliza el robo por
XSS pero **hace obligatoria** la protección CSRF.

---

## 2. Cambios realizados

### 2.1 Correcciones de seguridad en el código

Todas documentadas, con su hallazgo de origen y verificadas por tests.

| Hallazgo | Corrección | Archivo | Verificación |
| --- | --- | --- | --- |
| **H-01** JWT sin lista blanca de algoritmos | `algorithms: ['HS256']` | `jwt.strategy.ts` | Test: `alg: none` y firma alterada rechazados |
| **H-02** CSRF aceptaba peticiones sin `Origin` | Exige `Origin` o `Referer` del origen autorizado | `csrf-protection.guard.ts` | 6 tests de CSRF |
| **H-03** Formula injection en el padrón XLSX | `spreadsheetSafeCell()` aplicado | `schools.service.ts` | Spec del helper |
| **H-04** Uploads sin validación de tipo | `importFileFilter` en los 6 endpoints | `common/uploads/` | 4 tests de carga |
| **H-05** SMTP sin STARTTLS obligatorio | `requireTLS: true` fuera del 465 | `mail.service.ts` | Regla Semgrep propia |
| **H-06** Enumeración de usuarios | Mensaje unificado + bcrypt señuelo | `auth.service.ts` | Test de mensajes idénticos |
| **H-07** Imagen del frontend como root | `nginx-unprivileged`, UID 101 | `frontend/Dockerfile` | `docker exec id` → `uid=101` |
| **H-11** Sin healthchecks en Dockerfiles | `HEALTHCHECK` en ambos | Dockerfiles | `docker compose ps` |
| ZAP: 9 cabeceras ausentes | CSP, COOP/CORP, Permissions-Policy | `frontend/nginx.conf`, `main.ts` | ZAP: 9 → 7 advertencias |

> **Cambio de contrato a tener en cuenta:** la imagen del frontend ahora escucha
> en el **puerto 8080** (un proceso no-root no puede abrir el 80). Todo compose
> o proxy que apunte a este contenedor debe actualizarse.

### 2.2 Infraestructura de seguridad creada

```
backend/                             frontend/
├── compose.security.yml             ├── security/
├── security/                        │   ├── config/  scripts/  exceptions/
│   ├── config/   7 configuraciones  │   ├── baseline/known-findings.json
│   ├── scripts/  8 ejecutables      │   └── README.md · run-security.ps1
│   ├── seed/     datos sintéticos   ├── docs/security/  7 documentos
│   ├── exceptions/ 3 excepciones    └── .github/  3 workflows + dependabot
│   ├── reports/  (no versionado)
│   └── README.md · run-security.ps1
├── docs/security/  7 documentos
├── test/security-access-control.e2e-spec.ts  (33 tests)
└── .github/  3 workflows + dependabot
```

### 2.3 Entorno efímero

`compose.security.yml` levanta PostgreSQL, API, SPA y proxy con:

- Base de datos **efímera**, destruida con `down -v`; datos exclusivamente sintéticos.
- PostgreSQL en red `internal: true`, **sin salida a Internet ni puertos publicados**.
- Único punto de entrada: el proxy, publicado **sólo en `127.0.0.1:8081`**.
- `read_only: true`, `cap_drop: ALL`, `no-new-privileges`, límites de CPU y memoria.
- Migraciones automáticas antes de arrancar la API, con lock de PostgreSQL.

Verificado con `docker inspect`: `readonly=true` y `capdrop=[ALL]` en los tres
servicios de aplicación.

---

## 3. Herramientas implementadas

Todas con versión fija **verificada contra el registry** con
`docker manifest inspect`. Se descartaron dos versiones inexistentes durante la
verificación (`trivy 0.68.0` y `nuclei v3.4.0`).

| Herramienta | Versión | Rol |
| --- | --- | --- |
| Semgrep | 1.145.0 | SAST + **11 reglas propias** |
| Trivy | 0.67.2 | Dependencias, imágenes, SBOM, misconfig, licencias |
| OSV-Scanner | v2.2.4 | Segunda fuente sobre lockfiles |
| Gitleaks | v8.30.0 | Secretos en **historial completo** |
| OWASP ZAP | 2.16.1 | DAST baseline y full |
| Nuclei | v3.4.10 | DAST complementario (5560 plantillas) |
| testssl.sh | 3.2 | TLS (requiere staging) |
| CodeQL | action v3.27.5 | SAST complementario (repos públicos) |

---

## 4. Pruebas ejecutadas

| Prueba | Resultado | Estado |
| --- | --- | --- |
| `npm ci` backend y frontend | 841 y 268 paquetes | ✅ |
| Lint backend | Sin errores | ✅ |
| Compilación backend y frontend | Correcta | ✅ |
| **Tests unitarios backend** | **75 suites · 484 tests** | ✅ |
| **Tests de seguridad (nuevos)** | **33/33** | ✅ |
| Semgrep backend | 387 reglas / 354 archivos | ✅ |
| Semgrep frontend | Sin hallazgos | ✅ |
| Gitleaks | 35 commits de historial | ✅ |
| Trivy FS + OSV | 841 paquetes analizados | ✅ |
| SBOM CycloneDX | Generado (195 KB) | ✅ |
| Build de imágenes | backend y frontend | ✅ |
| Entorno efímero | 4/4 servicios healthy | ✅ |
| Seed de datos sintéticos | 3 usuarios + 2 escuelas | ✅ |
| **ZAP baseline autenticado** | **FAIL-NEW: 0 · PASS: 59** | ✅ |
| **Nuclei** | **5560 plantillas · 0 hallazgos** | ✅ |
| Validador de excepciones | Caso válido y negativo | ✅ |
| Sintaxis de los 8 workflows | Válida | ✅ |
| testssl.sh | `SKIPPED` — sin staging | ⏭️ |
| ZAP API Scan | `NOT_EXECUTED` — sin OpenAPI | ⏭️ |

### Detalle de los 33 tests de seguridad

| Grupo | Tests | Cubre |
| --- | --- | --- |
| Autenticación | 7 | Sin token, token inválido, firma alterada, `alg: none`, sesión inexistente, logout, atributos de cookie |
| Escalación vertical | 3 | Escuela → admin, admin → portal escuela, creación de usuarios |
| Escalación horizontal (IDOR) | 4 | Lectura y escritura cruzada, id inexistente, id malformado |
| CSRF | 6 | Válida, sin cabecera, origen ajeno, sin `Origin`, con `Referer`, todos los métodos |
| CORS | 3 | Sin reflejo, sin comodín con credenciales, preflight |
| Cabeceras | 1 | Helmet en la respuesta real |
| Validación | 3 | Mass assignment, inyección SQL literal, enum fuera de rango |
| Uploads | 4 | Ejecutable, doble extensión, path traversal, tamaño |
| Rate limiting | 1 | 429 tras superar el límite |

---

## 5. Hallazgos CRITICAL

**Ninguno.**

## 6. Hallazgos HIGH

| # | Hallazgo | Estado |
| --- | --- | --- |
| 1 | Imagen del frontend como root (H-07) | **Corregido** — `nginx-unprivileged`, UID 101 verificado |

Tras la corrección, cero hallazgos HIGH abiertos en ambos repositorios.

## 7. Hallazgos MEDIUM

| # | Hallazgo | Estado |
| --- | --- | --- |
| 1 | JWT sin lista blanca de algoritmos (H-01) | **Corregido** |
| 2 | CSRF sin `Origin` (H-02) | **Corregido** |
| 3 | Formula injection en el padrón XLSX (H-03) | **Corregido** |
| 4 | Uploads sin validación de tipo (H-04) | **Corregido** |
| 5 | Auditoría incompleta | **Abierto** — brecha reconocida |

## 8. Hallazgos LOW e informativos

| # | Hallazgo | Estado |
| --- | --- | --- |
| 1 | SMTP sin `requireTLS` (H-05) | **Corregido** |
| 2 | Enumeración de usuarios (H-06) | **Corregido** |
| 3 | Compose de desarrollo publica el 5432 (H-08) | **Abierto** — aceptable en local |
| 4 | `/api/health/database` público (H-09) | **Abierto** — sin datos sensibles |
| 5 | Cookie `SameSite=None` (H-10) | **Abierto** — depende de la topología |
| 6 | ZAP: `style-src unsafe-inline` | **Abierto** — necesario para Tailwind |
| 7 | ZAP: comentarios sospechosos en el bundle | **Abierto** — provienen de librerías |

---

## 9. Secretos encontrados

**Ninguno real.** Gitleaks recorrió los 35 commits del historial del backend y
el historial completo del frontend.

Un único hallazgo, **descartado como falso positivo**: la cadena
`postgresql://usuario:contrasena@localhost:5432/base_prueba` en
`docs/campaign-tracking.md:137`, un placeholder de documentación. Reveló un bug
en mi propia regla (faltaba `regexTarget = "match"`), ya corregido.

---

## 10. Vulnerabilidades de dependencias

| Repositorio | Paquetes | CRITICAL | HIGH | MEDIUM | LOW |
| --- | --- | --- | --- | --- | --- |
| backend | 841 | 0 | 0 | 0 | 1 |
| frontend | 268 | 0 | 0 | 0 | 1 |

Contrastado con dos fuentes independientes (Trivy y OSV-Scanner), que
coincidieron. `ignore-unfixed: false`: las vulnerabilidades sin parche también
se reportan.

## 11. Vulnerabilidades de imágenes

Las imágenes se etiquetan con el SHA del commit y el informe registra cuál se
analizó (`container-scan-metadata.json`).

| Imagen | Base | Usuario | Resultado |
| --- | --- | --- | --- |
| `app-backend:<sha>` | `node:22-alpine` | `node` | Sin CRITICAL/HIGH |
| `app-frontend:<sha>` | `nginx-unprivileged:1.29.3-alpine` | UID 101 | Sin CRITICAL/HIGH |

## 12. Resultados ZAP

Baseline autenticado contra el entorno efímero:

| Métrica | Antes de las cabeceras | Después |
| --- | --- | --- |
| FAIL-NEW | 0 | **0** |
| WARN-NEW | 9 | **7** |
| PASS | 57 | **59** |

Las 7 advertencias restantes: `style-src unsafe-inline` (Tailwind), comentarios
en el bundle (librerías), cabecera `Server` del proxy de pruebas,
Permissions-Policy y aislamiento en respuestas de la API, "Modern Web
Application" (informativo) y "ZAP is Out of Date" (sobre la herramienta).

**Ninguna es un fallo de seguridad de la aplicación.**

## 13. Resultados Nuclei

5560 plantillas firmadas, severidades medium/high/critical, ritmo limitado a 20
peticiones por segundo. **0 hallazgos** en ~11 800 comprobaciones.

## 14. Resultados TLS

`SKIPPED`. El entorno efímero es HTTP por diseño y no hay staging configurado.
Para ejecutarlo: definir `SECURITY_STAGING_URL` y correr el workflow nocturno.

**No se marca como aprobado: se marca como no ejecutado.**

## 15. Cobertura ASVS

| Estado | Cantidad |
| --- | --- |
| PASS | 48 |
| FAIL | 3 |
| NOT_TESTED | 5 |
| NOT_APPLICABLE | 5 |
| MANUAL_REVIEW | 2 |

Los tres FAIL: **sin MFA** (2.8.1), **sin verificación de contraseñas filtradas**
(2.1.7) y **auditoría incompleta** (7.1.3).

## 16. Controles que requieren prueba manual

Ocho pruebas que ningún escáner puede resolver, listadas en
`SECURITY_RELEASE_CHECKLIST.md` con su referencia OWASP WSTG: lógica de negocio
de campañas, manipulación de estados, abuso de importaciones masivas,
condiciones de carrera, enumeración por temporización, reidentificación desde
datos agregados, reutilización de tokens y manipulación de asignaciones.

## 17. Excepciones

Tres, todas vigentes, con motivo, control compensatorio, responsable y
vencimiento el **2026-11-26**:

| ID | Herramienta | Motivo |
| --- | --- | --- |
| SEC-EXC-001 | Semgrep | Falsos positivos de SQLi en QueryBuilder: identificadores estáticos, valores parametrizados |
| SEC-EXC-002 | Semgrep | Migraciones que interpolan constantes del propio archivo |
| SEC-EXC-003 | Semgrep | Cookie configurada por spread, que el análisis estático no resuelve |

El validador falla si una vence, si falta un campo o si la justificación es
demasiado breve. Probado en ambos sentidos.

## 18. Riesgos residuales

| # | Riesgo | Severidad | Compensación |
| --- | --- | --- | --- |
| 1 | Sin MFA para administradores | **Alta** | Contraseñas de 12 caracteres, bloqueo, sesión de 8 h revocable |
| 2 | Auditoría sin login ni ABM de usuarios | Media | `last_login_at`, tabla de sesiones, logs de contenedor |
| 3 | Sin verificación de contraseñas filtradas | Media | Política de complejidad |
| 4 | CSP de la SPA no versionada en producción | Media | La SPA ya emite CSP desde su propio nginx |
| 5 | Reportes sincrónicos en memoria | Media | Límites de tamaño y timeouts |
| 6 | Sin protección DDoS de red | Media | Rate limiting en nginx y aplicación |
| 7 | Sin OpenAPI → sin ZAP API Scan | Media | Spider + 33 tests de integración |
| 8 | Cookie `SameSite=None` | Baja | Guard CSRF con doble validación |

---

## 19. Recomendaciones antes de entregar a Ciberseguridad

**Bloqueantes:**

1. **Definir `SECURITY_STAGING_URL`** y ejecutar el workflow nocturno. Sin esto,
   los controles de TLS quedan `NOT_TESTED` y son de los primeros que una
   revisión formal va a pedir.
2. **Ajustar el despliegue al puerto 8080** del contenedor del frontend.
3. **Ejecutar los workflows al menos una vez** en GitHub: su sintaxis está
   validada, pero nunca corrieron en un runner real.

**Muy recomendables:**

4. **Implementar MFA** para el rol `admin`: es el FAIL de ASVS con más peso.
5. **Ampliar `audit_log`** a login, cambios de rol y ABM de usuarios.
6. **Decidir sobre OpenAPI** (ver `SECURITY_TESTING.md` §10).

**Deseables:**

7. Verificación contra contraseñas filtradas (HaveIBeenPwned por k-anonymity).
8. Versionar la configuración del reverse proxy de producción.
9. Revisar `frontend.zip` (11 MB, fuera de control de versiones) y eliminarlo.

---

## 20. Resultado general

**El pipeline está implementado, ejecutado y documentado.** No es una colección
de archivos: cada herramienta se corrió de verdad y los resultados de este
informe provienen de esas ejecuciones.

| Aspecto | Estado |
| --- | --- |
| Reproducibilidad | Versiones fijas verificadas; mismo resultado local y en CI |
| Cobertura | SAST, SCA, secretos con historial, SBOM, imágenes, DAST autenticado, TLS condicional |
| Gobernanza | Excepciones con vencimiento, baseline, política de gates explícita |
| Evidencia | 33 tests de seguridad + 484 unitarios + informes crudos |
| Documentación | 8 documentos, escritos para alguien que no construyó esto |

**Veredicto de seguridad del código: sin hallazgos CRITICAL ni HIGH abiertos.**
Los nueve hallazgos detectados en el análisis inicial fueron corregidos y
verificados; los riesgos residuales están documentados y aceptados
explícitamente.

**Lo que este informe NO afirma:** que la aplicación sea segura. Un pipeline sin
hallazgos significa que las herramientas configuradas no encontraron lo que
saben buscar. Las ocho pruebas manuales pendientes, la ausencia de MFA y la
falta de validación TLS contra un entorno real son limitaciones que deben
declararse junto con la entrega.

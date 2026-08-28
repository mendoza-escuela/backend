# Checklist de entrega a Ciberseguridad

Se completa **antes** de enviar una versión al departamento de Ciberseguridad.
Cada casilla exige evidencia concreta: un archivo, un identificador de
ejecución o un commit. "Se hizo" no es evidencia.

---

## Identificación de la versión

| Campo | Valor |
| --- | --- |
| Fecha de entrega | ____-__-__ |
| Responsable | ______________________ |
| Commit backend | `________________________________________` |
| Commit frontend | `________________________________________` |
| Rama | ______________________ |
| Versión / tag | ______________________ |
| Ejecución de referencia | GitHub Actions run `#__________` |
| Entorno auditado | ☐ efímero de CI ☐ staging `______________________` |

---

## 1. Build y pruebas

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 1.1 | `npm ci` reproducible en ambos repos | log del workflow | ☐ |
| 1.2 | Lint sin errores | log del workflow | ☐ |
| 1.3 | Compilación de backend y frontend | log del workflow | ☐ |
| 1.4 | Tests unitarios en verde (75 backend, 48 frontend) | log del workflow | ☐ |
| 1.5 | Tests e2e en verde | log del workflow | ☐ |
| 1.6 | **33 tests de seguridad en verde** | `security-access-control.e2e-spec.ts` | ☐ |

## 2. Análisis estático

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 2.1 | Semgrep ejecutado en ambos repos | `semgrep.json` · `semgrep.sarif` | ☐ |
| 2.2 | Sin hallazgos ERROR sin excepción vigente | `summary.md` | ☐ |
| 2.3 | Las 11 reglas propias se ejecutaron | `semgrep --validate` | ☐ |
| 2.4 | CodeQL ejecutado | pestaña Security | ☐ |

## 3. Dependencias

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 3.1 | Trivy filesystem en ambos repos | `trivy-fs.json` | ☐ |
| 3.2 | OSV-Scanner sobre todos los lockfiles | `osv.json` | ☐ |
| 3.3 | Sin CRITICAL sin excepción | `summary.md` | ☐ |
| 3.4 | HIGH revisados uno por uno | `summary.md` + baseline | ☐ |
| 3.5 | Vulnerabilidades sin parche listadas (no ocultadas) | `trivy-fs.json` | ☐ |
| 3.6 | Dependabot activo (npm, Docker, Actions) | `.github/dependabot.yml` | ☐ |

## 4. Secretos

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 4.1 | Gitleaks sobre el **historial completo** de ambos repos | `gitleaks.json` | ☐ |
| 4.2 | Cero secretos reales | `summary.md` | ☐ |
| 4.3 | Ninguna variable `VITE_*` contiene secretos | workflow `bundle-secrets` | ☐ |
| 4.4 | El bundle no expone credenciales ni source maps | workflow `bundle-secrets` | ☐ |
| 4.5 | Ningún `.env` versionado | `git ls-files` | ☐ |

## 5. SBOM

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 5.1 | SBOM CycloneDX del backend | `sbom.cyclonedx.json` | ☐ |
| 5.2 | SBOM CycloneDX del frontend | `sbom.cyclonedx.json` | ☐ |
| 5.3 | SBOM de la imagen final | `sbom-backend-image.cyclonedx.json` | ☐ |
| 5.4 | Guardado como artifact | run de Actions | ☐ |

## 6. Imágenes

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 6.1 | Imágenes etiquetadas con el SHA del commit | `container-scan-metadata.json` | ☐ |
| 6.2 | Trivy sobre la imagen del backend | `trivy-backend-image.json` | ☐ |
| 6.3 | Trivy sobre la imagen del frontend | `trivy-frontend-image.json` | ☐ |
| 6.4 | Ninguna corre como root | `docker run ... id -u` | ☐ |
| 6.5 | Sin `latest` en ninguna imagen base | Dockerfiles | ☐ |
| 6.6 | Sin secretos en las capas | `trivy image --scanners secret` | ☐ |

## 7. DAST

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 7.1 | ZAP baseline ejecutado | `zap-report.html` | ☐ |
| 7.2 | ZAP full scan (main/nightly) | `zap-report.html` | ☐ |
| 7.3 | **Escaneo autenticado** con token generado en la corrida | log `[AUTH] Token obtenido` | ☐ |
| 7.4 | Sin alertas de riesgo alto | `FAIL-NEW: 0` | ☐ |
| 7.5 | Nuclei ejecutado | `nuclei.json` | ☐ |
| 7.6 | Cada regla en IGNORE tiene justificación | `baseline-rules.conf` | ☐ |
| 7.7 | ZAP API Scan | **NO APLICA** — sin OpenAPI (ver `SECURITY_TESTING.md` §10) | ☐ |

## 8. Controles de aplicación

| # | Control | Evidencia | ☐ |
| --- | --- | --- | --- |
| 8.1 | Autenticación: token inválido, alterado y `alg: none` rechazados | SEC-E2E | ☐ |
| 8.2 | Logout invalida la sesión | SEC-E2E | ☐ |
| 8.3 | Sin escalación vertical | SEC-E2E · 3 tests | ☐ |
| 8.4 | Sin escalación horizontal (IDOR) | SEC-E2E · 4 tests | ☐ |
| 8.5 | CSRF: sin cabecera, origen ajeno y sin `Origin` rechazados | SEC-E2E · 6 tests | ☐ |
| 8.6 | CORS: sin reflejo de origen ni comodín con credenciales | SEC-E2E · 3 tests | ☐ |
| 8.7 | Cabeceras de seguridad presentes | SEC-E2E + ZAP | ☐ |
| 8.8 | Rate limiting comprobado | SEC-E2E | ☐ |
| 8.9 | Uploads: tipo, extensión, traversal y tamaño | SEC-E2E · 4 tests | ☐ |
| 8.10 | Mass assignment rechazado | SEC-E2E | ☐ |

## 9. TLS

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 9.1 | testssl.sh contra staging | `testssl.json` | ☐ |
| 9.2 | Sólo TLS 1.2 y 1.3 | `testssl.json` | ☐ |
| 9.3 | Certificado y cadena válidos | `testssl.json` | ☐ |
| 9.4 | HSTS presente | `testssl.json` | ☐ |
| 9.5 | Si no hay staging: marcado `SKIPPED`, no omitido en silencio | `summary.md` | ☐ |

## 10. Gobernanza

| # | Verificación | Evidencia | ☐ |
| --- | --- | --- | --- |
| 10.1 | Excepciones validadas y **ninguna vencida** | `validate-exceptions.py` | ☐ |
| 10.2 | Cada excepción con motivo, control compensatorio y responsable | `security-exceptions.yml` | ☐ |
| 10.3 | Toda supresión en herramientas remite a un `SEC-EXC-` | configuraciones | ☐ |
| 10.4 | Checklist ASVS actualizado | `ASVS_CHECKLIST.md` | ☐ |
| 10.5 | Threat model vigente | `THREAT_MODEL.md` | ☐ |
| 10.6 | Riesgos residuales aceptados por escrito | `SECURITY_CONTROLS.md` | ☐ |

## 11. Resultado

| Campo | Valor |
| --- | --- |
| Veredicto de `summary.md` | ☐ PASS ☐ PASS WITH WARNINGS ☐ FAIL |
| Hallazgos CRITICAL abiertos | ______ |
| Hallazgos HIGH abiertos | ______ |
| Excepciones vigentes | ______ |
| Controles ASVS en FAIL | ______ |

**No se entrega con veredicto FAIL.**

---

## Limitaciones a declarar explícitamente

Estas limitaciones se informan **junto con** la entrega. Ocultarlas invalida el
resto del trabajo.

| # | Limitación | Detalle |
| --- | --- | --- |
| 1 | **Sin MFA** | Las cuentas administradoras dependen sólo de la contraseña |
| 2 | **Auditoría parcial** | `audit_log` no cubre autenticación ni gestión de usuarios |
| 3 | **Sin verificación de contraseñas filtradas** | No se contrasta contra corpus públicos |
| 4 | **Sin ZAP API Scan** | El backend no expone OpenAPI |
| 5 | **CSP de la SPA no versionada** | Depende del reverse proxy de producción |
| 6 | **Sin protección DDoS de red** | Corresponde a la infraestructura provincial |
| 7 | **DAST autenticado por Bearer** | Con Bearer el guard CSRF se salta por diseño; CSRF se valida por tests |
| 8 | **Autoevaluación** | El checklist ASVS lo completó el equipo de desarrollo |

---

## Pruebas que requieren revisión manual

No se pueden automatizar por completo. Ver §12 de `SECURITY_TESTING.md` y
OWASP WSTG.

| # | Prueba | Referencia WSTG |
| --- | --- | --- |
| 1 | Lógica de negocio de campañas y evaluaciones | WSTG-BUSL |
| 2 | Manipulación del flujo de estados de una campaña | WSTG-BUSL-06 |
| 3 | Abuso funcional de importaciones masivas | WSTG-BUSL-07 |
| 4 | Condiciones de carrera en el envío de cuestionarios | WSTG-BUSL-09 |
| 5 | Enumeración por diferencias de tiempo | WSTG-IDNT-04 |
| 6 | Datos agregados que permitan reidentificar una escuela | WSTG-ATHZ |
| 7 | Reutilización de tokens de recuperación | WSTG-ATHN-03 |
| 8 | Escalada por manipulación de asignaciones escuela-usuario | WSTG-ATHZ-03 |

---

**Firma del responsable:** ______________________  **Fecha:** ____-__-__

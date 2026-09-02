# Pipeline de seguridad

Validación de seguridad reproducible, ejecutable en una notebook y en CI con el
mismo resultado. Todas las herramientas corren en contenedores con versión
fijada: **no hace falta instalar nada más que Docker**. Las imágenes se cargan
y validan siempre mediante `security/scripts/load-tool-versions.sh`.

---

## Uso rápido

```bash
./security/scripts/run-all.sh                 # suite completa (~20 min)
./security/scripts/run-all.sh --static-only   # estático + imágenes, sin stack/DAST
./security/scripts/run-all.sh --full-dast     # ZAP full scan
./security/scripts/run-all.sh --keep-env      # deja el entorno levantado
```

En Windows: `.\security\run-security.ps1`

Resultado en `security/reports/summary.md`.

Para analizar un staging donde frontend y API usan dominios separados:

```bash
SECURITY_STAGING_URL=https://frontend-staging.example \
SECURITY_STAGING_API_URL=https://api-staging.example \
SECURITY_ADMIN_EMAIL=security@example \
SECURITY_ADMIN_PASSWORD='...' \
./security/scripts/run-all.sh --full-dast
```

Las credenciales deben pertenecer a un administrador exclusivo del entorno de
pruebas. Si `SECURITY_STAGING_API_URL` no se define, se asume que la API vive
bajo el mismo origen que el frontend.

En CI, el checkout cruzado conserva una pareja coherente: los PR usan la rama
objetivo (`main` o `develop`) del frontend y los workflows de `main`/nocturno
usan frontend `main`. Así los informes no mezclan ramas con destinos distintos.

---

## Qué hace cada script

| Script | Función | Herramientas |
| --- | --- | --- |
| `run-all.sh` | Orquesta las seis etapas y aplica el veredicto | todas |
| `run-static.sh` | SAST, SCA, secretos y SBOM | Semgrep, Gitleaks, Trivy, OSV |
| `run-container-scan.sh` | Construye las imágenes reales y las analiza | Docker, Trivy |
| `run-dast.sh` | Escaneo dinámico autenticado | ZAP, Nuclei, testssl.sh |
| `wait-for-app.sh` | Espera a que el entorno esté utilizable | curl |
| `security-compose.sh` | Carga las versiones y delega en Compose | Docker Compose |
| `load-tool-versions.sh` | Valida y exporta todas las imágenes canónicas | Bash |
| `setup-project-npm.sh` | Instala el npm fijado en `packageManager` para CI | Node.js, npm |
| `create-summary.sh` | Consolida y aplica la política de gates | Python |
| `validate-exceptions.py` | Falla si hay excepciones vencidas o mal formadas | Python |

---

## Herramientas y versiones

Fijadas exclusivamente en `security/config/tool-versions.env` y **verificadas
contra el registry** con `docker manifest inspect`. Nunca `latest`: un pipeline
de seguridad que cambia de versión sin avisar no es comparable entre
ejecuciones. El helper rechaza variables faltantes, adicionales, duplicadas y
referencias sin tag o digest fijo antes de ejecutar una herramienta.

| Herramienta | Fuente | Rol |
| --- | --- | --- |
| Python | `PYTHON_IMAGE` | Runtime de respaldo para los consolidadores |
| Semgrep | `SEMGREP_IMAGE` | SAST + reglas propias |
| Trivy | `TRIVY_IMAGE` | Dependencias, imágenes, SBOM, misconfig |
| OSV-Scanner | `OSV_SCANNER_IMAGE` | Segunda fuente sobre los lockfiles |
| Gitleaks | `GITLEAKS_IMAGE` | Secretos en el historial completo |
| OWASP ZAP | `ZAP_IMAGE` | DAST |
| Nuclei | `NUCLEI_IMAGE` | DAST complementario |
| testssl.sh | `TESTSSL_IMAGE` | TLS (sólo staging) |
| PostgreSQL | `SECURITY_POSTGRES_IMAGE` | Base efímera de pruebas |
| Nginx | `SECURITY_NGINX_IMAGE` | Proxy efímero de pruebas |

Los workflows no repiten la versión de npm: `setup-project-npm.sh` la deriva
de `package.json#packageManager`. Los valores de `uses:` de GitHub Actions son
la única excepción técnica a la centralización: GitHub no admite variables ni
expresiones en ese campo, por lo que sus SHA quedan fijados y comentados en cada
workflow.

Backend y frontend conservan copias vendorizadas de los helpers comunes. La
duplicación es deliberada: cada repositorio debe poder ejecutar y versionar su
pipeline por separado. Las pruebas de integridad de cada uno mantienen esas
copias alineadas con su inventario local.

---

## Política de bloqueo

**FAIL** (bloquea):

1. Cualquier secreto detectado.
2. CRITICAL sin excepción vigente.
3. HIGH **nuevo** respecto del baseline.
4. Alerta de riesgo alto en ZAP.
5. Excepción **vencida**.
6. Informe requerido ausente, vacío o inválido.
7. SBOM o metadato obligatorio ausente o vacío.

**PASS WITH WARNINGS**: MEDIUM/LOW y HIGH ya conocidos en el baseline.

> `NOT_EXECUTED` **no** equivale a `PASS`. Si una herramienta no dejó informe,
> el gate falla. Los jobs parciales declaran su alcance con
> `--partial --require-group static|container|dast`; sin grupo explícito, el
> consolidador rechaza la ejecución.

---

## Reglas de trabajo

1. **No se silencia un hallazgo sin una excepción formal.** Toda supresión
   (`paths.exclude` de Semgrep, `.trivyignore`, `IGNORE` de ZAP) debe citar un
   `SEC-EXC-` de `exceptions/security-exceptions.yml`.
2. **Las excepciones vencen.** Máximo 90 días. Una vencida rompe el build a
   propósito.
3. **Sin `|| true` ni `continue-on-error` general.** Los scripts distinguen
   "encontré hallazgos" de "no pude ejecutarme" capturando los códigos de salida
   por separado.
4. **Las vulnerabilidades sin parche siguen apareciendo.**
   `ignore-unfixed: false` está puesto deliberadamente.
5. **El DAST activo nunca corre contra producción.** `run-dast.sh` valida el
   destino antes de enviar la primera petición y aborta si no es el entorno
   local o el staging declarado.

---

## Entorno efímero

```bash
./security/scripts/security-compose.sh --profile full up -d --build
./security/scripts/wait-for-app.sh
./security/scripts/security-compose.sh --profile seed run --rm sec-seed
# ... pruebas ...
./security/scripts/security-compose.sh --profile full --profile seed --profile tests down -v
```

- Base de datos efímera, destruida con `down -v`.
- Datos exclusivamente sintéticos.
- PostgreSQL en red `internal: true`, sin puertos publicados.
- Único punto de entrada: el proxy, **sólo en `127.0.0.1:8081`**.
- Contenedores con `read_only`, `cap_drop: ALL`, `no-new-privileges` y usuario
  no-root.

---

## Estructura

```
security/
├── config/       versiones, reglas y configuración de cada herramienta
├── scripts/      ejecución, helpers y pruebas de integridad
├── seed/         datos sintéticos para el DAST autenticado
├── exceptions/   excepciones formales con vencimiento
├── baseline/     hallazgos ya conocidos (opcional)
└── reports/      salida — no se versiona
```

---

**"Sin vulnerabilidades detectadas" no significa "aplicación segura".** Este
pipeline automatiza lo automatizable y no reemplaza la revisión manual.

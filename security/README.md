# Pipeline de seguridad

Validación de seguridad reproducible, ejecutable en una notebook y en CI con el
mismo resultado. Todas las herramientas corren en contenedores con versión
fijada: **no hace falta instalar nada más que Docker**.

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
| `create-summary.sh` | Consolida y aplica la política de gates | Python |
| `validate-exceptions.py` | Falla si hay excepciones vencidas o mal formadas | Python |

---

## Herramientas y versiones

Fijadas en `config/tool-versions.env` y **verificadas contra el registry** con
`docker manifest inspect`. Nunca `latest`: un pipeline de seguridad que cambia
de versión sin avisar no es comparable entre ejecuciones.

| Herramienta | Versión | Rol |
| --- | --- | --- |
| Semgrep | 1.145.0 | SAST + 11 reglas propias |
| Trivy | 0.74.0 | Dependencias, imágenes, SBOM, misconfig |
| OSV-Scanner | v2.2.4 | Segunda fuente sobre los lockfiles |
| Gitleaks | v8.30.0 | Secretos en el historial completo |
| OWASP ZAP | 2.17.0 | DAST |
| Nuclei | v3.4.10 | DAST complementario |
| testssl.sh | 3.2 | TLS (sólo staging) |

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
docker compose -f compose.security.yml --profile full up -d --build
./security/scripts/wait-for-app.sh
docker compose -f compose.security.yml --profile seed run --rm sec-seed
# ... pruebas ...
docker compose -f compose.security.yml --profile full --profile seed --profile tests down -v
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
├── scripts/      los seis scripts ejecutables
├── seed/         datos sintéticos para el DAST autenticado
├── exceptions/   excepciones formales con vencimiento
├── baseline/     hallazgos ya conocidos (opcional)
└── reports/      salida — no se versiona
```

---

**"Sin vulnerabilidades detectadas" no significa "aplicación segura".** Este
pipeline automatiza lo automatizable y no reemplaza la revisión manual.

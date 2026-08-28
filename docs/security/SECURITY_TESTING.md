# Guía de pruebas de seguridad

Documento operativo. Está escrito para que alguien que **no** construyó este
pipeline pueda ejecutarlo, interpretarlo y mantenerlo.

| Campo | Valor |
| --- | --- |
| Repositorios | `mendoza-escuela/backend` · `mendoza-escuela/frontend` |
| Estándar | OWASP ASVS 5.0 Nivel 2 |
| Última actualización | 2026-08-28 |

---

## 1. Requisitos

| Herramienta | Versión | Para qué |
| --- | --- | --- |
| Docker | 24+ con Compose v2 | Todo el pipeline corre en contenedores |
| Git | cualquiera | Gitleaks necesita el historial |
| Bash | 4+ | Los scripts. En Windows: Git Bash o WSL |

**No hace falta instalar Semgrep, Trivy, ZAP, Nuclei ni Python.** Todas las
herramientas corren en contenedores con la versión fijada en
`security/config/tool-versions.env`.

La primera ejecución descarga unos **6 GB** de imágenes (ZAP solo pesa 3,6 GB) y
las plantillas de Nuclei. Las siguientes reutilizan la caché.

---

## 2. Estructura

```
security/
├── config/
│   ├── tool-versions.env        versiones fijadas (verificadas contra el registry)
│   ├── trivy.yaml               severidades, scanners, licencias
│   ├── gitleaks.toml            reglas propias + allowlist justificada
│   ├── semgrep/custom-rules.yml 11 reglas específicas del proyecto
│   ├── zap/baseline-rules.conf  qué alerta bloquea y cuál sólo advierte
│   ├── nuclei/config.yaml       severidades y límite de peticiones
│   └── nginx/                   proxy del entorno efímero
├── scripts/
│   ├── run-all.sh               orquestador completo
│   ├── run-static.sh            SAST + SCA + secretos + SBOM
│   ├── run-container-scan.sh    build + Trivy sobre las imágenes
│   ├── run-dast.sh              ZAP + Nuclei + testssl
│   ├── wait-for-app.sh          espera a que el entorno esté utilizable
│   ├── create-summary.sh        aplica la política de gates
│   ├── summarize.py             consolida los informes
│   └── validate-exceptions.py   valida vencimientos y formato
├── exceptions/security-exceptions.yml
├── baseline/known-findings.json  (opcional) hallazgos ya conocidos
└── reports/                      salida — NO se versiona
```

---

## 3. Ejecución local

### Todo de una vez

```bash
cd backend
./security/scripts/run-all.sh
```

Levanta el entorno, ejecuta las seis etapas, genera el resumen y **destruye el
entorno con sus datos**. Tarda entre 15 y 25 minutos la primera vez.

Variantes:

```bash
./security/scripts/run-all.sh --static-only   # sin Docker Compose, ~5 min
./security/scripts/run-all.sh --full-dast     # ZAP full scan (activo)
./security/scripts/run-all.sh --keep-env      # deja el entorno para inspeccionar
```

### Por etapas

```bash
./security/scripts/run-static.sh          # Semgrep, Gitleaks, Trivy FS, OSV, SBOM
./security/scripts/run-container-scan.sh  # build + Trivy sobre las imágenes
./security/scripts/run-dast.sh            # ZAP baseline + Nuclei
./security/scripts/create-summary.sh      # consolidar y aplicar la política
```

### En Windows

```powershell
.\security\run-security.ps1              # suite completa
.\security\run-security.ps1 -StaticOnly  # sólo estático
```

El wrapper de PowerShell comprueba Docker y delega en los mismos scripts, así
que el resultado es idéntico al de Linux.

---

## 4. Entorno efímero

### Levantar

```bash
cd backend
docker compose -f compose.security.yml --profile full up -d --build
./security/scripts/wait-for-app.sh
docker compose -f compose.security.yml --profile seed run --rm sec-seed
```

Queda disponible en `http://localhost:8081`, **sólo en la interfaz de
loopback**: no es accesible desde la red.

### Destruir

```bash
docker compose -f compose.security.yml --profile full --profile seed --profile tests down -v
```

El `-v` es obligatorio: borra el volumen con los datos sintéticos.

### Qué contiene

| Servicio | Puerto | Publicado |
| --- | --- | --- |
| `sec-proxy` | 80 | **Sí**, sólo en `127.0.0.1:8081` |
| `sec-web` | 8080 | No |
| `sec-api` | 4000 | No |
| `sec-db` | 5432 | No — red `internal: true` |

### Cuentas sintéticas

| Usuario | Rol | Para qué |
| --- | --- | --- |
| `security_admin@ci.local` | admin | DAST autenticado |
| `security_school@ci.local` | school | Escuela A |
| `security_school_b@ci.local` | school | Escuela B — el par necesario para probar IDOR |

Las contraseñas están en `compose.security.yml` con valores sintéticos y sólo
sirven dentro de este entorno, que se destruye en cada corrida. Para cambiarlas,
exportá `SECURITY_ADMIN_PASSWORD` y equivalentes.

**Diferencia deliberada con producción:** el seed crea las cuentas con
`mustChangePassword: false`. Con el cambio de contraseña forzado activo, el
`PasswordChangeRequiredGuard` bloquearía la navegación y el escáner no podría
recorrer la aplicación.

---

## 5. Escaneos autenticados

`run-dast.sh` se autentica solo:

1. Hace login contra el entorno con la cuenta administradora sintética.
2. Extrae el JWT del encabezado `Set-Cookie`.
3. Lo inyecta como `Authorization: Bearer` en todas las peticiones de ZAP.

**El token se genera en cada corrida y nunca se escribe en disco.**

> **Por qué Bearer y no cookie:** la cookie se emite con el atributo `Secure` y
> el entorno de CI es HTTP, así que ningún cliente que respete el estándar la
> conservaría. La API acepta `Authorization: Bearer` como transporte
> alternativo.
>
> **Consecuencia importante:** con Bearer y sin cookie, el guard anti-CSRF se
> salta **por diseño** (un token en cabecera no lo adjunta el navegador solo).
> Por eso **ZAP no valida CSRF**: eso lo cubren los 6 tests de
> `test/security-access-control.e2e-spec.ts`.

---

## 6. Staging y TLS

El entorno efímero es HTTP a propósito, así que analizar su TLS no tendría
sentido. Para auditar TLS de verdad hace falta un staging con HTTPS:

```bash
export SECURITY_STAGING_URL="https://staging.ejemplo.gob.ar"
./security/scripts/run-dast.sh
```

En GitHub Actions se define como secreto `SECURITY_STAGING_URL` o como input del
workflow nocturno. **Si no está definida, testssl.sh se marca `SKIPPED` y el
pipeline no falla por eso.**

`run-dast.sh` valida el destino **antes** de enviar una sola petición: sólo
acepta `localhost`/`127.0.0.1` o exactamente la URL de `SECURITY_STAGING_URL`.
Cualquier otro host aborta la ejecución. Nunca contra producción.

---

## 7. Interpretación de resultados

Todo termina en `security/reports/summary.md`.

| Veredicto | Significado | Acción |
| --- | --- | --- |
| **PASS** | Sin hallazgos bloqueantes ni advertencias | Continuar |
| **PASS WITH WARNINGS** | Hay MEDIUM/LOW o HIGH ya conocidos en el baseline | Revisar antes de cerrar |
| **FAIL** | Bloqueante | Corregir o documentar una excepción |

### Qué provoca FAIL

1. Cualquier secreto detectado por Gitleaks.
2. Hallazgo CRITICAL sin excepción vigente.
3. Hallazgo HIGH **nuevo** respecto del baseline.
4. Alerta de riesgo alto en ZAP.
5. Excepción de seguridad **vencida**.
6. Herramienta que debía ejecutarse y falló.

> **NOT_EXECUTED no es PASS.** Si una herramienta no dejó informe, el resumen lo
> dice explícitamente. Un informe incompleto no aprueba nada.

### Vulnerabilidad "nueva" vs "conocida"

`security/baseline/known-findings.json` lista los hallazgos ya evaluados. Un
hallazgo del baseline **sigue apareciendo con su severidad real** en el informe,
pero no bloquea un PR que no lo introdujo. Uno que no esté en la lista, bloquea.

Las vulnerabilidades **sin parche disponible** siguen apareciendo:
`ignore-unfixed: false` está puesto a propósito en `trivy.yaml`.

---

## 8. Excepciones

### Agregar una

Editá `security/exceptions/security-exceptions.yml`:

```yaml
  - id: SEC-EXC-004
    tool: trivy
    finding: CVE-2026-12345
    reason: >-
      Por qué se acepta hoy. Concreto y verificable.
    compensating_control: >-
      Qué mitiga el riesgo mientras tanto. Un control real, no una intención.
    owner: nombre.apellido
    created: 2026-08-28
    expires: 2026-11-26
```

Reglas que el validador impone (y falla si no se cumplen):

- Los ocho campos son obligatorios.
- `expires` no puede superar los **90 días** desde `created`.
- Prohibidos los comodines y las justificaciones de menos de 25 caracteres.
- `owner` debe ser una persona identificable.

Validá antes de commitear:

```bash
python3 security/scripts/validate-exceptions.py
```

### Renovar o eliminar

Una excepción vencida **rompe el build**, y es deliberado: obliga a decidir de
nuevo en lugar de dejar que la deuda se vuelva permanente. Para renovarla, hay
que actualizar `created`, `expires` y **revisar que la justificación siga
siendo cierta**. Para eliminarla, corregí el hallazgo y borrá la entrada.

### Relación con los archivos propios de cada herramienta

`security-exceptions.yml` es la **única fuente de verdad**. Las supresiones en
formatos nativos (`paths.exclude` de Semgrep, `.trivyignore`, `IGNORE` en las
reglas de ZAP) deben citar el `id` correspondiente en un comentario. Una
supresión sin su entrada es, en sí misma, un hallazgo.

---

## 9. GitHub Actions

Cada repositorio tiene sus tres workflows.

| Workflow | Disparador | Qué hace |
| --- | --- | --- |
| `security-pr.yml` | `pull_request` | Calidad, SAST, SCA, secretos, SBOM, imagen y —en el backend— entorno efímero + tests + ZAP baseline |
| `security-main.yml` | `push` a main, manual | Todo lo anterior más informes completos y CodeQL |
| `security-nightly.yml` | cron diario, manual | Suite completa con ZAP full scan y, si hay staging, Nuclei y testssl |

**Horario del nocturno:** backend 03:17 UTC, frontend 03:47 UTC (00:17 y 00:47
en Argentina). Para cambiarlo, editá la expresión `cron` del workflow, siempre
en UTC.

**Por qué existe el nocturno:** una vulnerabilidad puede publicarse sin que
cambie una línea de código. Un pipeline que sólo corre en PRs no lo detectaría.

### Seguridad del propio pipeline

- `permissions: contents: read` por defecto; cada job amplía sólo lo que necesita.
- **Nunca `pull_request_target`**: ejecutaría el workflow con los secretos del
  repositorio sobre código de un fork.
- Todas las actions de terceros están **pineadas por SHA**, no por tag: un tag
  puede reapuntarse a otro código.
- Dependabot actualiza npm, Docker y **github-actions** (sin esto, los SHA
  pineados quedarían congelados para siempre).
- Sin `curl | bash`: todas las herramientas vienen de imágenes con versión fija.
- Los secretos nunca se imprimen; Gitleaks corre con `--redact`.

### Artifacts en repositorios públicos

**Estos repositorios son públicos y los artifacts de Actions son descargables
por cualquiera.** Por eso:

- En los PR sólo se publican `summary.md` y el SBOM, sin el detalle explotable.
- Los informes crudos se guardan únicamente en `main` y en el nocturno, con
  retención de 7 y 14 días.

---

## 10. Limitación conocida: no hay OpenAPI

El backend **no expone Swagger/OpenAPI** (verificado en la Fase 1: cero
referencias a `@nestjs/swagger`). En consecuencia:

- **ZAP API Scan no se puede ejecutar.** No hay contrato que darle.
- ZAP recorre la aplicación mediante spider, que descubre menos superficie que
  un contrato explícito: los endpoints a los que sólo se llega por acciones de
  la SPA pueden quedar sin cubrir.

**No se agregó `@nestjs/swagger` por cuenta propia**: sería una dependencia
nueva en producción y una decisión de arquitectura que corresponde al equipo.

Si Ciberseguridad exige cobertura de API completa, hay dos caminos:

1. **Agregar `@nestjs/swagger`** y exponer el JSON sólo en entornos no
   productivos (`NODE_ENV !== 'production'`), o detrás de autenticación de
   administrador. Después, en `run-dast.sh`, agregar `zap-api-scan.py -f openapi`.
2. **Escribir el contrato a mano** en `security/config/zap/openapi.yaml`
   partiendo de los 18 controladores. Sin dependencias nuevas, pero hay que
   mantenerlo sincronizado.

La opción 1 es preferible: un contrato desincronizado da una falsa sensación de
cobertura.

---

## 11. Qué entregar a Ciberseguridad

Ver `SECURITY_RELEASE_CHECKLIST.md`. En resumen:

1. `summary.md` de la última corrida sobre el commit que se entrega.
2. SBOM CycloneDX de código e imágenes.
3. `ASVS_CHECKLIST.md` con la evidencia de cada control.
4. `THREAT_MODEL.md`.
5. `security-exceptions.yml` con las excepciones vigentes.
6. Informes crudos de la corrida de `main` (artifact `security-reports-<sha>`).

---

## 12. Problemas frecuentes

| Síntoma | Causa | Solución |
| --- | --- | --- |
| `no templates provided for scan` (Nuclei) | Plantillas no descargadas | El script usa un volumen persistente; verificá salida a Internet |
| ZAP: `Level is not a supported level` | `baseline-rules.conf` sin TABs | El separador debe ser TAB, no espacios |
| `AVISO: no se pudo extraer el token` | Faltan los datos sintéticos | `docker compose -f compose.security.yml --profile seed run --rm sec-seed` |
| Los e2e "pasan" sin ejecutarse | Falta `TEST_DATABASE_URL` | Se saltan en silencio por diseño; el servicio `sec-tests` la define |
| `429 Too Many Requests` en los tests | Rate limiting del login | Es correcto: la suite comparte una cuota de 10 logins/minuto |
| Gitleaks marca un placeholder | Falta `regexTarget = "match"` | Agregarlo a la allowlist de la regla |
| El compose no encuentra el frontend | Repos hermanos | `export SECURITY_FRONTEND_CONTEXT=/ruta/al/frontend` |
| Trivy tarda 5+ minutos | El escáner de secretos procesa los `.xlsx`/`.pdf` de `docs/` | Es esperable, no un cuelgue. Para acelerar en local: `--scanners vuln,misconfig,license` |
| Trivy no termina nunca | Está escaneando `security/reports/`, que crece en cada corrida | Ya excluido en `trivy.yaml`; verificá que `skip-dirs` incluya `/src/security/reports` |

#!/usr/bin/env bash
# =============================================================================
# Análisis estático: SAST + SCA + secretos + SBOM
#
# Ejecuta las cinco herramientas contra el repositorio actual y deja los
# informes crudos en security/reports/. No modifica código ni aplica políticas:
# la decisión PASS/FAIL la toma create-summary.sh a partir de estos informes.
#
# SOBRE LOS CÓDIGOS DE SALIDA: cada herramienta devuelve un código distinto para
# "encontré hallazgos" y para "no pude ejecutarme". El script los captura por
# separado a propósito, para poder correr las cinco aunque una falle y para no
# confundir un error de infraestructura con un hallazgo de seguridad.
# NO se usa `|| true`: ningún resultado se descarta.
#
# Uso:
#   ./security/scripts/run-static.sh
#
# Requisitos: Docker. No hace falta instalar ninguna herramienta en el host.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPORTS_DIR="${REPO_ROOT}/security/reports"
CONFIG_DIR="${REPO_ROOT}/security/config"

# Docker en Git Bash/MSYS reescribe las rutas de los montajes si no se desactiva.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) export MSYS_NO_PATHCONV=1 ;;
esac

# shellcheck source=/dev/null
set -a && . "${CONFIG_DIR}/tool-versions.env" && set +a

mkdir -p "${REPORTS_DIR}"

PROJECT_NAME="$(basename "${REPO_ROOT}")"
COMMIT_SHA="$( (cd "${REPO_ROOT}" 2>/dev/null && git rev-parse HEAD 2>/dev/null) || echo "sin-git")"

declare -A TOOL_STATUS=()
declare -A TOOL_EXIT=()

log()     { printf '\n\033[1m[%s]\033[0m %s\n' "$1" "$2"; }
record()  { TOOL_EXIT["$1"]=$2; TOOL_STATUS["$1"]="$3"; }

docker_run() {
  docker run --rm \
    -v "${REPO_ROOT}:/src" \
    -w /src \
    "$@"
}

# -----------------------------------------------------------------------------
# 1. SAST — Semgrep
#    Packs públicos + reglas propias del proyecto.
#    Salida JSON (para el resumen) y SARIF (para GitHub Code Scanning).
# -----------------------------------------------------------------------------
run_semgrep() {
  log SEMGREP "SAST sobre ${PROJECT_NAME}"
  local common=(
    --config=p/security-audit
    --config=p/owasp-top-ten
    --config=p/javascript
    --config=p/typescript
    --config=p/nodejs
    --config=p/secrets
    --config=/src/security/config/semgrep/custom-rules.yml
    --metrics=off
    --disable-version-check
    --exclude=node_modules
    --exclude=dist
    --exclude=coverage
    --exclude=security/reports
  )

  docker_run "${SEMGREP_IMAGE}" semgrep scan \
    "${common[@]}" --json --output=/src/security/reports/semgrep.json .
  local json_exit=$?

  docker_run "${SEMGREP_IMAGE}" semgrep scan \
    "${common[@]}" --sarif --output=/src/security/reports/semgrep.sarif .
  local sarif_exit=$?

  # Semgrep: 0 = sin hallazgos, 1 = hallazgos, >1 = error de ejecución.
  if [ "${json_exit}" -le 1 ] && [ "${sarif_exit}" -le 1 ]; then
    record semgrep "${json_exit}" "OK"
  else
    record semgrep "${json_exit}" "ERROR_DE_EJECUCION"
  fi
}

# -----------------------------------------------------------------------------
# 2. Secretos — Gitleaks
#    Recorre TODO el historial de commits, no sólo el árbol de trabajo:
#    una credencial borrada hace meses sigue estando en el historial.
#    --redact evita que el secreto aparezca en logs o artifacts.
# -----------------------------------------------------------------------------
run_gitleaks() {
  log GITLEAKS "Buscando secretos en el historial completo"

  if [ ! -d "${REPO_ROOT}/.git" ]; then
    log GITLEAKS "AVISO: no es un repositorio git; se escanea sólo el directorio"
    docker_run "${GITLEAKS_IMAGE}" dir /src \
      --config=/src/security/config/gitleaks.toml \
      --report-format=json \
      --report-path=/src/security/reports/gitleaks.json \
      --redact --no-banner --exit-code 0
    record gitleaks $? "OK_SIN_HISTORIAL"
    return
  fi

  docker_run "${GITLEAKS_IMAGE}" git /src \
    --config=/src/security/config/gitleaks.toml \
    --report-format=json \
    --report-path=/src/security/reports/gitleaks.json \
    --redact --no-banner \
    --exit-code 0
  # --exit-code 0: los hallazgos NO se pierden, quedan en gitleaks.json y el
  # gate los evalúa en create-summary.sh. Así distinguimos "hubo fugas" de
  # "gitleaks no pudo correr".
  local exit_code=$?
  if [ "${exit_code}" -eq 0 ]; then
    record gitleaks 0 "OK"
  else
    record gitleaks "${exit_code}" "ERROR_DE_EJECUCION"
  fi
}

# -----------------------------------------------------------------------------
# 3. SCA + misconfig + licencias — Trivy filesystem
# -----------------------------------------------------------------------------
run_trivy_fs() {
  log TRIVY "Dependencias, misconfiguraciones, secretos y licencias"
  docker_run -v trivy-cache:/root/.cache/trivy "${TRIVY_IMAGE}" fs \
    --config /src/security/config/trivy.yaml \
    --format json \
    --output /src/security/reports/trivy-fs.json \
    /src
  local exit_code=$?
  [ "${exit_code}" -eq 0 ] && record trivy-fs 0 "OK" || record trivy-fs "${exit_code}" "ERROR_DE_EJECUCION"
}

# -----------------------------------------------------------------------------
# 4. SCA independiente — OSV-Scanner
#    Segunda fuente de datos sobre los mismos lockfiles: Trivy y OSV no siempre
#    coinciden, y para una revisión formal conviene el contraste.
# -----------------------------------------------------------------------------
run_osv() {
  log OSV "Analizando lockfiles contra la base OSV"
  local lockfiles=()
  while IFS= read -r lockfile; do
    lockfiles+=("--lockfile=/src/${lockfile#./}")
  done < <(cd "${REPO_ROOT}" && find . -name "package-lock.json" -not -path "*/node_modules/*" | sort)

  if [ "${#lockfiles[@]}" -eq 0 ]; then
    log OSV "No se encontraron lockfiles"
    record osv 0 "SIN_LOCKFILES"
    return
  fi

  log OSV "Lockfiles: ${#lockfiles[@]}"
  docker_run "${OSV_SCANNER_IMAGE}" scan source \
    "${lockfiles[@]}" \
    --format json --output /src/security/reports/osv.json
  # OSV: 0 = sin vulnerabilidades, 1 = vulnerabilidades, 127/128 = error.
  local exit_code=$?
  if [ "${exit_code}" -le 1 ]; then
    record osv "${exit_code}" "OK"
  else
    record osv "${exit_code}" "ERROR_DE_EJECUCION"
  fi
}

# -----------------------------------------------------------------------------
# 5. SBOM CycloneDX
# -----------------------------------------------------------------------------
run_sbom() {
  log SBOM "Generando inventario de componentes (CycloneDX)"
  docker_run -v trivy-cache:/root/.cache/trivy "${TRIVY_IMAGE}" fs \
    --format cyclonedx \
    --output /src/security/reports/sbom.cyclonedx.json \
    /src
  local exit_code=$?
  [ "${exit_code}" -eq 0 ] && record sbom 0 "OK" || record sbom "${exit_code}" "ERROR_DE_EJECUCION"
}

# -----------------------------------------------------------------------------
main() {
  printf '=== Análisis estático — %s @ %s ===\n' "${PROJECT_NAME}" "${COMMIT_SHA:0:8}"

  run_semgrep
  run_gitleaks
  run_trivy_fs
  run_osv
  run_sbom

  printf '\n=== Estado de ejecución ===\n'
  local failed=0
  for tool in semgrep gitleaks trivy-fs osv sbom; do
    printf '  %-10s %-20s (exit %s)\n' \
      "${tool}" "${TOOL_STATUS[$tool]:-NO_EJECUTADO}" "${TOOL_EXIT[$tool]:-NA}"
    case "${TOOL_STATUS[$tool]:-NO_EJECUTADO}" in
      ERROR_DE_EJECUCION | NO_EJECUTADO) failed=1 ;;
    esac
  done

  printf '\nInformes en: security/reports/\n'
  if [ "${failed}" -ne 0 ]; then
    printf '\nERROR: al menos una herramienta no pudo ejecutarse. El informe está incompleto.\n' >&2
    return 1
  fi
  printf '\nTodas las herramientas se ejecutaron. Ejecutá create-summary.sh para aplicar la política.\n'
  return 0
}

main "$@"

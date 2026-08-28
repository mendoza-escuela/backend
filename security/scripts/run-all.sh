#!/usr/bin/env bash
# =============================================================================
# Ejecuta la suite completa de seguridad y produce el veredicto final.
#
#   1. Validación de excepciones (una vencida rompe el pipeline)
#   2. Análisis estático: Semgrep, Gitleaks, Trivy FS, OSV, SBOM
#   3. Build + escaneo de imágenes
#   4. Entorno efímero + tests de control de acceso
#   5. DAST: ZAP + Nuclei (+ testssl si hay staging)
#   6. Resumen consolidado y política de gates
#
# Uso:
#   ./security/scripts/run-all.sh                 suite completa
#   ./security/scripts/run-all.sh --static-only   sólo estático (sin Docker Compose)
#   ./security/scripts/run-all.sh --full-dast     ZAP full scan en lugar de baseline
#   ./security/scripts/run-all.sh --keep-env      no destruye el entorno al terminar
#
# Cada etapa deja constancia de si se ejecutó. Una etapa omitida NO cuenta como
# aprobada: aparece como NOT_EXECUTED en el resumen final.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/compose.security.yml"

STATIC_ONLY=0
FULL_DAST=0
KEEP_ENV=0
for arg in "$@"; do
  case "${arg}" in
    --static-only) STATIC_ONLY=1 ;;
    --full-dast)   FULL_DAST=1 ;;
    --keep-env)    KEEP_ENV=1 ;;
    *) printf 'Opción desconocida: %s\n' "${arg}" >&2; exit 2 ;;
  esac
done

declare -A STAGE_STATUS=()
STAGE_ORDER=()

stage() {
  local name="$1"
  shift
  STAGE_ORDER+=("${name}")
  printf '\n\033[1;34m======== %s ========\033[0m\n' "${name}"
  if "$@"; then
    STAGE_STATUS["${name}"]="OK"
  else
    STAGE_STATUS["${name}"]="FALLO"
  fi
}

skip_stage() {
  STAGE_ORDER+=("$1")
  STAGE_STATUS["$1"]="NOT_EXECUTED"
  printf '\n\033[1;33m======== %s (NOT_EXECUTED) ========\033[0m\n%s\n' "$1" "$2"
}

compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

cleanup_env() {
  if [ "${KEEP_ENV}" -eq 1 ]; then
    printf '\nEntorno conservado (--keep-env). Para destruirlo:\n'
    printf '  docker compose -f compose.security.yml --profile full down -v\n'
    return
  fi
  printf '\n[LIMPIEZA] Destruyendo el entorno efímero y sus datos\n'
  compose --profile full --profile seed --profile tests down -v >/dev/null 2>&1
}

cd "${REPO_ROOT}"

# --- 1. Excepciones ----------------------------------------------------------
# En Windows, `python3` existe como alias de la Microsoft Store que falla con un
# mensaje en stdout y código de salida distinto de cero. Por eso no alcanza con
# `command -v`: se comprueba que el intérprete realmente ejecute algo.
stage "Excepciones de seguridad" bash -c '
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) export MSYS_NO_PATHCONV=1 ;;
  esac
  if python3 -c "import sys" >/dev/null 2>&1; then
    python3 security/scripts/validate-exceptions.py
  else
    docker run --rm -v "$(pwd)":/src -w /src python:3.13-alpine \
      python security/scripts/validate-exceptions.py
  fi'

# --- 2. Estático -------------------------------------------------------------
stage "Análisis estático" bash "${SCRIPT_DIR}/run-static.sh"

# --- 3. Imágenes -------------------------------------------------------------
stage "Build y escaneo de imágenes" bash "${SCRIPT_DIR}/run-container-scan.sh"

if [ "${STATIC_ONLY}" -eq 1 ]; then
  skip_stage "Entorno efímero" "Omitido por --static-only."
  skip_stage "Tests de control de acceso" "Omitido por --static-only."
  skip_stage "DAST" "Omitido por --static-only."
else
  # --- 4. Entorno + tests ----------------------------------------------------
  stage "Entorno efímero" bash -c "
    docker compose -f '${COMPOSE_FILE}' --profile full up -d --build &&
    bash '${SCRIPT_DIR}/wait-for-app.sh' &&
    docker compose -f '${COMPOSE_FILE}' --profile seed run --rm sec-seed"

  stage "Tests de control de acceso" bash -c "
    docker compose -f '${COMPOSE_FILE}' --profile tests run --rm sec-tests"

  # --- 5. DAST ---------------------------------------------------------------
  if [ "${FULL_DAST}" -eq 1 ]; then
    stage "DAST (full scan)" bash "${SCRIPT_DIR}/run-dast.sh" --full
  else
    stage "DAST (baseline)" bash "${SCRIPT_DIR}/run-dast.sh"
  fi
fi

# --- 6. Resumen --------------------------------------------------------------
printf '\n\033[1;34m======== Resumen y política de gates ========\033[0m\n'
bash "${SCRIPT_DIR}/create-summary.sh"
GATE_RESULT=$?

cleanup_env

printf '\n=== Etapas ===\n'
PIPELINE_OK=0
for name in "${STAGE_ORDER[@]}"; do
  printf '  %-32s %s\n' "${name}" "${STAGE_STATUS[$name]}"
  [ "${STAGE_STATUS[$name]}" = "FALLO" ] && PIPELINE_OK=1
done

printf '\nInforme completo: security/reports/summary.md\n'

if [ "${GATE_RESULT}" -ne 0 ]; then
  printf '\n\033[1;31mRESULTADO: FAIL — la política de seguridad bloquea este cambio.\033[0m\n'
  exit 1
fi
if [ "${PIPELINE_OK}" -ne 0 ]; then
  printf '\n\033[1;31mRESULTADO: FAIL — alguna etapa no pudo completarse.\033[0m\n'
  exit 1
fi
printf '\n\033[1;32mRESULTADO: la política de seguridad no bloquea este cambio.\033[0m\n'
printf 'Revisá las advertencias del resumen antes de dar el cambio por cerrado.\n'

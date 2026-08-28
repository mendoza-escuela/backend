#!/usr/bin/env bash
# =============================================================================
# Consolida los informes de security/reports/ y aplica la política de gates.
#
# Produce security/reports/summary.md y devuelve:
#   0  PASS  |  PASS WITH WARNINGS
#   1  FAIL
#
# Usa el Python del host si está disponible; si no, lo ejecuta en contenedor,
# de modo que el resultado sea idéntico en una notebook y en un runner de CI.
#
# Uso:
#   ./security/scripts/create-summary.sh [--strict-high]
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PYTHON_IMAGE="python:3.13-alpine"

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) export MSYS_NO_PATHCONV=1 ;;
esac

BASELINE_ARG=()
if [ -f "${REPO_ROOT}/security/baseline/known-findings.json" ]; then
  BASELINE_ARG=(--baseline security/baseline/known-findings.json)
fi

# git no está disponible dentro del contenedor de Python: los metadatos de
# trazabilidad se resuelven acá, en el host, y se pasan por parámetro.
# Se usa `cd` en un subshell en lugar de `git -C`: en Git Bash sobre Windows,
# `git -C /c/ruta/estilo/msys` falla en silencio y el informe pierde el commit.
git_meta() {
  (cd "${REPO_ROOT}" 2>/dev/null && git "$@" 2>/dev/null) || echo desconocido
}

META_ARG=(
  --project "$(basename "${REPO_ROOT}")"
  --commit "$(git_meta rev-parse HEAD)"
  --branch "$(git_meta rev-parse --abbrev-ref HEAD)"
)

run_with_host_python() {
  # No basta `command -v`: en Windows python3 es un alias de la Store que
  # falla al ejecutarse. Se comprueba que el intérprete realmente funcione.
  python3 -c "import sys" >/dev/null 2>&1 || return 1
  (cd "${REPO_ROOT}" && python3 security/scripts/summarize.py "${BASELINE_ARG[@]}" "${META_ARG[@]}" "$@")
}

run_with_docker_python() {
  docker run --rm \
    -v "${REPO_ROOT}:/src" \
    -w /src \
    "${PYTHON_IMAGE}" \
    python security/scripts/summarize.py "${BASELINE_ARG[@]}" "${META_ARG[@]}" "$@"
}

if run_with_host_python "$@"; then
  exit 0
else
  status=$?
  # 1 = veredicto FAIL (resultado legítimo). Otro código = no había Python.
  if [ "${status}" -eq 1 ] && command -v python3 >/dev/null 2>&1; then
    exit 1
  fi
fi

run_with_docker_python "$@"

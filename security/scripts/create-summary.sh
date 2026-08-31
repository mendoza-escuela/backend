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
#   ./security/scripts/create-summary.sh --partial --require-group static
# Grupos parciales: static, container, dast. --require-group es repetible.
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

# Se decide PRIMERO por qué vía se ejecuta y DESPUÉS se ejecuta una sola vez.
#
# La versión anterior intentaba el host y usaba el código de salida para decidir
# si reintentar en Docker, pero no podía distinguir "no hay Python" (1) de
# "veredicto FAIL" (1). En Windows, donde `command -v python3` encuentra el
# alias de la Microsoft Store que no ejecuta nada, el resultado era el peor
# posible: el script devolvía FAIL sin haber generado ni evaluado el resumen.
#
# `python3 -c "import sys"` comprueba que el intérprete realmente funcione, no
# sólo que exista una entrada en el PATH.
if python3 -c "import sys" >/dev/null 2>&1; then
  cd "${REPO_ROOT}" || exit 2
  exec python3 security/scripts/summarize.py \
    "${BASELINE_ARG[@]}" "${META_ARG[@]}" "$@"
fi

echo "Python no disponible en el host: se usa ${PYTHON_IMAGE}." >&2
exec docker run --rm \
  -v "${REPO_ROOT}:/src" \
  -w /src \
  "${PYTHON_IMAGE}" \
  python security/scripts/summarize.py \
  "${BASELINE_ARG[@]}" "${META_ARG[@]}" "$@"

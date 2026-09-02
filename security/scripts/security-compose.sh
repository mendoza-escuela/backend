#!/usr/bin/env bash
# Única entrada a compose.security.yml: carga y valida las imágenes primero.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# shellcheck source=load-tool-versions.sh
. "${SCRIPT_DIR}/load-tool-versions.sh" || exit $?

cd "${REPO_ROOT}"
exec docker compose -f compose.security.yml "$@"

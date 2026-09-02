#!/usr/bin/env bash
# Instala la versión de npm declarada por package.json#packageManager.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_ROOT}"
PACKAGE_MANAGER="$(node -p "require('./package.json').packageManager || ''")"
if [[ ! "${PACKAGE_MANAGER}" =~ ^npm@[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'package.json#packageManager debe declarar npm con versión exacta; recibido: %s\n' \
    "${PACKAGE_MANAGER:-vacío}" >&2
  exit 2
fi

exec npm install --global "${PACKAGE_MANAGER}"

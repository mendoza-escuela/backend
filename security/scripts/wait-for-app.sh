#!/usr/bin/env bash
# =============================================================================
# Espera a que el entorno efímero de seguridad esté realmente utilizable.
#
# No alcanza con que los contenedores existan: PostgreSQL debe estar healthy,
# las migraciones deben haber terminado y la API debe responder. Arrancar un
# DAST antes de eso produce hallazgos falsos (502, timeouts) que ensucian el
# informe.
#
# Uso:
#   ./security/scripts/wait-for-app.sh [URL_BASE] [TIMEOUT_SEGUNDOS]
#
# Salida: 0 si la aplicación responde; 1 si se agota el tiempo.
# =============================================================================
set -euo pipefail

BASE_URL="${1:-${SECURITY_APP_URL:-http://localhost:8081}}"
TIMEOUT="${2:-180}"
INTERVAL=3

log() { printf '[wait-for-app] %s\n' "$1"; }

wait_for() {
  local description="$1" url="$2" deadline elapsed=0
  deadline=$((TIMEOUT))
  log "Esperando ${description} en ${url}"
  while [ "$elapsed" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      log "OK: ${description} respondió tras ${elapsed}s"
      return 0
    fi
    sleep "$INTERVAL"
    elapsed=$((elapsed + INTERVAL))
  done
  log "TIMEOUT: ${description} no respondió en ${deadline}s"
  return 1
}

# 1. El proxy es el único punto de entrada publicado.
wait_for "el proxy" "${BASE_URL}/healthz" || exit 1

# 2. La API sólo responde /api/health cuando las migraciones terminaron:
#    start-production.cjs no arranca NestJS hasta completarlas.
wait_for "la API (migraciones aplicadas)" "${BASE_URL}/api/health" || exit 1

# 3. La conexión a la base debe estar viva de verdad, no sólo el proceso.
wait_for "la base de datos" "${BASE_URL}/api/health/database" || exit 1

# 4. La SPA es opcional: sólo existe con el perfil `full`.
if curl -fsS --max-time 5 "${BASE_URL}/" >/dev/null 2>&1; then
  log "OK: la SPA responde"
else
  log "AVISO: la SPA no responde (¿entorno levantado sin el perfil 'full'?)"
fi

log "Entorno listo para las pruebas de seguridad."

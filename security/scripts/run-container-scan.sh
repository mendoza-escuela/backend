#!/usr/bin/env bash
# =============================================================================
# Construye las MISMAS imágenes que se desplegarían y las analiza con Trivy.
#
# Las imágenes se etiquetan con el SHA del commit para que el informe indique
# exactamente qué artefacto se auditó: sin eso, "la imagen no tiene CVEs
# críticos" no significa nada.
#
# Uso:
#   ./security/scripts/run-container-scan.sh
#
# Variables:
#   SECURITY_FRONTEND_CONTEXT  ruta al repo del frontend (por defecto ../frontend)
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPORTS_DIR="${REPO_ROOT}/security/reports"
CONFIG_DIR="${REPO_ROOT}/security/config"
FRONTEND_CONTEXT="${SECURITY_FRONTEND_CONTEXT:-${REPO_ROOT}/../frontend}"

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) export MSYS_NO_PATHCONV=1 ;;
esac

# shellcheck source=/dev/null
set -a && . "${CONFIG_DIR}/tool-versions.env" && set +a

mkdir -p "${REPORTS_DIR}"

git_meta() { (cd "$1" 2>/dev/null && git rev-parse HEAD 2>/dev/null) || echo "sin-git"; }

BACKEND_SHA="$(git_meta "${REPO_ROOT}")"
FRONTEND_SHA="$(git_meta "${FRONTEND_CONTEXT}")"

BACKEND_IMAGE="app-backend:${BACKEND_SHA:0:12}"
FRONTEND_IMAGE="app-frontend:${FRONTEND_SHA:0:12}"

log() { printf '\n\033[1m[%s]\033[0m %s\n' "$1" "$2"; }

STATUS=0

# -----------------------------------------------------------------------------
build_image() {
  local context="$1" tag="$2" name="$3"
  shift 3
  log BUILD "${name} -> ${tag}"
  if [ ! -f "${context}/Dockerfile" ]; then
    log BUILD "ERROR: no existe ${context}/Dockerfile"
    return 1
  fi
  # Se entra al directorio y se usa "." como contexto en lugar de pasar la ruta
  # absoluta. Motivo: este script exporta MSYS_NO_PATHCONV=1 para los montajes
  # de Docker, y con esa variable `docker build /c/ruta/estilo/msys` falla con
  # "unable to prepare context: path not found". Con `cd` + "." la ruta la
  # resuelve el shell y funciona igual en Linux, macOS y Git Bash.
  (cd "${context}" && docker build -t "${tag}" "$@" .)
}

scan_image() {
  local tag="$1" output="$2" name="$3"
  log TRIVY "Analizando ${name} (${tag})"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v trivy-cache:/root/.cache/trivy \
    -v "${REPORTS_DIR}:/reports" \
    -v "${CONFIG_DIR}:/config:ro" \
    "${TRIVY_IMAGE}" image \
    --config /config/trivy.yaml \
    --scanners vuln,secret \
    --format json \
    --output "/reports/${output}" \
    "${tag}"
}

# -----------------------------------------------------------------------------
log INFO "Backend  commit ${BACKEND_SHA}"
log INFO "Frontend commit ${FRONTEND_SHA}"

if build_image "${REPO_ROOT}" "${BACKEND_IMAGE}" "backend"; then
  scan_image "${BACKEND_IMAGE}" "trivy-backend-image.json" "backend" || STATUS=1
else
  log BUILD "El backend no se pudo construir: el escaneo de su imagen queda NOT_EXECUTED"
  STATUS=1
fi

if [ -d "${FRONTEND_CONTEXT}" ]; then
  if build_image "${FRONTEND_CONTEXT}" "${FRONTEND_IMAGE}" "frontend" \
    --build-arg "VITE_API_URL=/api"; then
    scan_image "${FRONTEND_IMAGE}" "trivy-frontend-image.json" "frontend" || STATUS=1
  else
    log BUILD "El frontend no se pudo construir: escaneo NOT_EXECUTED"
    STATUS=1
  fi
else
  log INFO "No se encontró el repositorio del frontend en ${FRONTEND_CONTEXT}: se omite."
fi

# -----------------------------------------------------------------------------
# SBOM de las imágenes finales, no sólo del código fuente: incluye los paquetes
# del sistema operativo base, que es donde suelen aparecer los CVEs.
log SBOM "Generando SBOM de la imagen del backend"
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v trivy-cache:/root/.cache/trivy \
  -v "${REPORTS_DIR}:/reports" \
  "${TRIVY_IMAGE}" image \
  --format cyclonedx \
  --output /reports/sbom-backend-image.cyclonedx.json \
  "${BACKEND_IMAGE}" || STATUS=1

# Deja constancia de qué se analizó exactamente.
cat > "${REPORTS_DIR}/container-scan-metadata.json" <<EOF
{
  "generated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backend": { "image": "${BACKEND_IMAGE}", "commit": "${BACKEND_SHA}" },
  "frontend": { "image": "${FRONTEND_IMAGE}", "commit": "${FRONTEND_SHA}" }
}
EOF

log INFO "Informes en security/reports/"
exit "${STATUS}"

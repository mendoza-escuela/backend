#!/usr/bin/env bash
# =============================================================================
# DAST: OWASP ZAP + Nuclei contra el entorno efímero (o un staging autorizado).
#
# SALVAGUARDA DE ALCANCE: sólo se permite atacar 127.0.0.1/localhost o la URL
# declaradas en SECURITY_STAGING_URL/SECURITY_STAGING_API_URL. Cualquier otro
# destino aborta la ejecución.
# Nunca se ejecuta contra producción.
#
# Modos:
#   ./security/scripts/run-dast.sh                 baseline (pull requests)
#   ./security/scripts/run-dast.sh --full          full scan (main/nightly)
#
# El escaneo autenticado obtiene un token real en cada corrida: no hay tokens
# escritos en ningún archivo.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPORTS_DIR="${REPO_ROOT}/security/reports"
CONFIG_DIR="${REPO_ROOT}/security/config"
EDGE_NETWORK="${SECURITY_EDGE_NETWORK:-mendoza-security_sec-edge}"
LOCAL_PROXY_URL="${SECURITY_LOCAL_PROXY_URL:-http://sec-proxy}"

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) export MSYS_NO_PATHCONV=1 ;;
esac

# shellcheck source=/dev/null
set -a && . "${CONFIG_DIR}/tool-versions.env" && set +a

mkdir -p "${REPORTS_DIR}"

MODE="baseline"
[ "${1:-}" = "--full" ] && MODE="full"

TARGET_URL="${SECURITY_STAGING_URL:-${SECURITY_APP_URL:-http://localhost:8081}}"
API_URL="${SECURITY_STAGING_API_URL:-${TARGET_URL}}"

ADMIN_EMAIL="${SECURITY_ADMIN_EMAIL:-security_admin@ci.local}"
ADMIN_PASSWORD="${SECURITY_ADMIN_PASSWORD:-CiSynthetic#Admin2026}"

log()  { printf '\n\033[1m[%s]\033[0m %s\n' "$1" "$2"; }
fail() { printf '\n\033[1;31m[ABORTADO]\033[0m %s\n' "$1" >&2; exit 1; }

is_local_url() {
  local host
  host="$(printf '%s' "$1" | sed -E 's#^[a-zA-Z]+://##; s#[:/].*$##')"
  case "${host}" in
    localhost | 127.0.0.1 | ::1 | host.docker.internal) return 0 ;;
    *) return 1 ;;
  esac
}

# -----------------------------------------------------------------------------
# 1. Verificación de alcance — se ejecuta ANTES de cualquier petición
# -----------------------------------------------------------------------------
assert_url_allowed() {
  local url="$1" label="$2" host
  host="$(printf '%s' "${url}" | sed -E 's#^[a-zA-Z]+://##; s#[:/].*$##')"

  case "${host}" in
    localhost | 127.0.0.1 | ::1 | host.docker.internal)
      log ALCANCE "${label} local autorizado: ${url}"
      return 0
      ;;
  esac

  if { [ -n "${SECURITY_STAGING_URL:-}" ] && [ "${url}" = "${SECURITY_STAGING_URL}" ]; } ||
     { [ -n "${SECURITY_STAGING_API_URL:-}" ] && [ "${url}" = "${SECURITY_STAGING_API_URL}" ]; }; then
    log ALCANCE "${label} de staging declarado explícitamente: ${url}"
    return 0
  fi

  fail "El destino ${url} no está autorizado.
  Sólo se permite el entorno efímero local o las URL de staging declaradas.
  Este script nunca debe ejecutarse contra producción."
}

assert_target_allowed() {
  assert_url_allowed "${TARGET_URL}" "Frontend"
  [ "${API_URL}" = "${TARGET_URL}" ] || assert_url_allowed "${API_URL}" "API"
}

# -----------------------------------------------------------------------------
# 2. Autenticación: token real obtenido en esta misma corrida
# -----------------------------------------------------------------------------
AUTH_TOKEN=""

obtain_token() {
  log AUTH "Autenticando como ${ADMIN_EMAIL}"
  local login_output response

  # Los encabezados se capturan con `-D -` (a stdout), sin archivo temporal.
  # Motivo: este script exporta MSYS_NO_PATHCONV=1 para los montajes de Docker,
  # y con esa variable el curl nativo de Windows no resuelve rutas como /tmp,
  # con lo que -D dejaba el archivo vacío y la autenticación fallaba en silencio.
  login_output="$(curl -s -D - -o /dev/null -w '\nHTTP_STATUS:%{http_code}' \
    -X POST "${API_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -H 'X-CSRF-Protection: 1' \
    -H "Origin: ${TARGET_URL}" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")"

  response="$(printf '%s' "${login_output}" |
    sed -n 's/^HTTP_STATUS:\([0-9]*\).*/\1/p' | tail -n 1)"

  if [ "${response}" != "200" ]; then
    log AUTH "AVISO: el login devolvió ${response:-sin respuesta}. El DAST correrá SIN autenticar."
    log AUTH "Creá los datos sintéticos con: docker compose -f compose.security.yml --profile seed run --rm sec-seed"
    return 1
  fi

  # El token se lee del encabezado Set-Cookie: la cookie se emite con el
  # atributo Secure y el entorno de CI es HTTP, así que ningún cliente que
  # respete el estándar la conservaría. Se usa como Bearer, transporte
  # alternativo que la API acepta (jwt.strategy.ts). Vive sólo en memoria.
  AUTH_TOKEN="$(printf '%s' "${login_output}" |
    sed -n 's/.*[Ss]et-[Cc]ookie: *access_token=\([^;]*\).*/\1/p' | head -n 1)"

  if [ -z "${AUTH_TOKEN}" ]; then
    log AUTH "AVISO: no se pudo extraer el token. El DAST correrá SIN autenticar."
    return 1
  fi

  log AUTH "Token obtenido (${#AUTH_TOKEN} caracteres). No se escribe en disco."
  return 0
}

# -----------------------------------------------------------------------------
# 3. OWASP ZAP
# -----------------------------------------------------------------------------
run_zap() {
  local zap_script="zap-baseline.py"

  if [ "${MODE}" = "full" ]; then
    zap_script="zap-full-scan.py"
    log ZAP "FULL SCAN — activo e intrusivo. Sólo contra CI o staging autorizado."
  else
    log ZAP "BASELINE — pasivo, apto para pull requests."
  fi

  rm -f "${REPORTS_DIR}"/zap-report.* \
        "${REPORTS_DIR}"/zap-frontend-report.* \
        "${REPORTS_DIR}"/zap-api-report.*
  # La imagen oficial de ZAP corre con un UID no-root. En runners Linux ese UID
  # no coincide con el dueño del checkout y necesita poder crear zap.yaml y los
  # informes dentro del único directorio de salida montado.
  chmod a+rwx "${REPORTS_DIR}"

  if [ "${API_URL}" = "${TARGET_URL}" ]; then
    run_zap_target "${TARGET_URL}" "zap-report" "${zap_script}" 1
    return $?
  fi

  local status=0
  run_zap_target "${TARGET_URL}" "zap-frontend-report" "${zap_script}" 0 || status=1
  run_zap_target "${API_URL}" "zap-api-report" "${zap_script}" 1 || status=1
  return "${status}"
}

run_zap_target() {
  local target_url="$1" report_prefix="$2" zap_script="$3" use_auth="$4"
  local extra_args=()
  local network_args=()

  # En Linux, un puerto publicado sólo en 127.0.0.1 no es alcanzable desde otro
  # contenedor mediante host.docker.internal. Para el entorno efímero, ZAP se
  # une a la red edge y accede al proxy por DNS interno. Staging conserva su URL.
  local zap_target="${target_url}"
  if is_local_url "${target_url}"; then
    zap_target="${LOCAL_PROXY_URL}"
    network_args=(--network "${EDGE_NETWORK}")
  fi

  if [ "${use_auth}" -eq 1 ] && [ -n "${AUTH_TOKEN}" ]; then
    # Cabecera de autorización para TODAS las peticiones del escáner.
    extra_args+=(-z "-config replacer.full_list(0).description=auth \
-config replacer.full_list(0).enabled=true \
-config replacer.full_list(0).matchtype=REQ_HEADER \
-config replacer.full_list(0).matchstr=Authorization \
-config replacer.full_list(0).regex=false \
-config replacer.full_list(0).replacement=Bearer|${AUTH_TOKEN}")
    log ZAP "Escaneo AUTENTICADO de ${target_url} (Bearer)."
    log ZAP "NOTA: con Bearer y sin cookie, el guard CSRF se salta por diseño."
    log ZAP "      La protección CSRF se valida en test/security-access-control.e2e-spec.ts."
  else
    log ZAP "Escaneo NO autenticado de ${target_url}: superficie pública."
  fi

  docker run --rm \
    "${network_args[@]}" \
    -v "${REPORTS_DIR}:/zap/wrk:rw" \
    -v "${CONFIG_DIR}/zap:/zap/config:ro" \
    "${ZAP_IMAGE}" \
    "${zap_script}" \
    -t "${zap_target}" \
    -c /zap/config/baseline-rules.conf \
    -J "${report_prefix}.json" \
    -r "${report_prefix}.html" \
    -w "${report_prefix}.md" \
    -I \
    "${extra_args[@]}"

  # ZAP: 0 = sin avisos, 1 = FAIL segun reglas, 2 = WARN. >2 es error real.
  local exit_code=$?
  if [ "${exit_code}" -le 2 ]; then
    log ZAP "Finalizado (código ${exit_code}). Informes: ${report_prefix}.{json,html,md}"
    return 0
  fi
  log ZAP "ERROR de ejecución (código ${exit_code})"
  return 1
}

# -----------------------------------------------------------------------------
# 4. Nuclei
# -----------------------------------------------------------------------------
run_nuclei() {
  log NUCLEI "Plantillas medium/high/critical, ritmo limitado"
  local nuclei_target="${TARGET_URL}"
  local nuclei_api_target="${API_URL}"
  local network_args=()
  if is_local_url "${TARGET_URL}"; then
    nuclei_target="${LOCAL_PROXY_URL}"
    network_args=(--network "${EDGE_NETWORK}")
  fi
  if is_local_url "${API_URL}"; then
    nuclei_api_target="${LOCAL_PROXY_URL}"
    network_args=(--network "${EDGE_NETWORK}")
  fi
  local target_args=(-target "${nuclei_target}")
  if [ "${nuclei_api_target}" != "${nuclei_target}" ]; then
    target_args+=(-target "${nuclei_api_target}")
  fi

  # Las plantillas no vienen en la imagen: se descargan la primera vez y quedan
  # en un volumen para las corridas siguientes. Sin esto Nuclei aborta con
  # "no templates provided for scan".
  docker run --rm \
    "${network_args[@]}" \
    -v "${REPORTS_DIR}:/reports" \
    -v "${CONFIG_DIR}/nuclei:/config:ro" \
    -v nuclei-templates:/root/nuclei-templates \
    -v nuclei-config:/root/.config/nuclei \
    "${NUCLEI_IMAGE}" \
    "${target_args[@]}" \
    -config /config/config.yaml \
    -jsonl -output /reports/nuclei.json \
    -no-interactsh

  local exit_code=$?
  # Nuclei devuelve 0 tanto con hallazgos como sin ellos; el archivo manda.
  if [ "${exit_code}" -eq 0 ]; then
    [ -f "${REPORTS_DIR}/nuclei.json" ] || : > "${REPORTS_DIR}/nuclei.json"
    log NUCLEI "Finalizado. Informe: nuclei.json"
    return 0
  fi
  log NUCLEI "ERROR de ejecución (código ${exit_code})"
  return 1
}

# -----------------------------------------------------------------------------
# 5. TLS — sólo si hay staging HTTPS declarado
# -----------------------------------------------------------------------------
run_testssl() {
  if [ -z "${SECURITY_STAGING_URL:-}" ]; then
    log TESTSSL "SKIPPED: no hay SECURITY_STAGING_URL definida."
    log TESTSSL "El entorno efímero es HTTP a propósito; analizar su TLS no tendría sentido."
    return 0
  fi
  case "${SECURITY_STAGING_URL}" in
    https://*) ;;
    *)
      log TESTSSL "SKIPPED: SECURITY_STAGING_URL no usa HTTPS."
      return 0
      ;;
  esac

  local status=0
  run_testssl_target "${SECURITY_STAGING_URL}" "frontend" || status=1
  if [ "${API_URL}" != "${SECURITY_STAGING_URL}" ]; then
    run_testssl_target "${API_URL}" "api" || status=1
  fi
  return "${status}"
}

run_testssl_target() {
  local url="$1" label="$2"
  case "${url}" in
    https://*) ;;
    *)
      log TESTSSL "SKIPPED: ${label} no usa HTTPS (${url})."
      return 0
      ;;
  esac

  log TESTSSL "Analizando TLS de ${label}: ${url}"
  docker run --rm \
    -v "${REPORTS_DIR}:/reports" \
    "${TESTSSL_IMAGE}" \
    --jsonfile "/reports/testssl-${label}.json" \
    --quiet --color 0 \
    --protocols --std --headers --vulnerable \
    "${url}"
}

# -----------------------------------------------------------------------------
main() {
  assert_target_allowed

  log ESPERA "Comprobando que la aplicación responda"
  if ! bash "${SCRIPT_DIR}/wait-for-app.sh" "${TARGET_URL}" 120 "${API_URL}"; then
    fail "La aplicación no responde (frontend: ${TARGET_URL}, API: ${API_URL})."
  fi

  obtain_token || true

  local status=0
  run_zap    || status=1
  run_nuclei || status=1
  run_testssl || status=1

  printf '\n=== DAST finalizado (modo %s) ===\n' "${MODE}"
  printf 'Informes en security/reports/\n'
  return "${status}"
}

main "$@"

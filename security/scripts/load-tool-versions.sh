#!/usr/bin/env bash
# Carga de forma estricta la fuente canónica de imágenes de seguridad.
# Este archivo está pensado para ser incluido con `source`; no ejecuta Docker.

_load_security_tool_versions() {
  local script_dir versions_file line name value expected_name
  local -a expected=(
    PYTHON_IMAGE
    SEMGREP_IMAGE
    TRIVY_IMAGE
    OSV_SCANNER_IMAGE
    GITLEAKS_IMAGE
    ZAP_IMAGE
    NUCLEI_IMAGE
    TESTSSL_IMAGE
    SECURITY_POSTGRES_IMAGE
    SECURITY_NGINX_IMAGE
  )
  local -A allowed=()
  local -A seen=()

  for expected_name in "${expected[@]}"; do
    allowed["${expected_name}"]=1
  done

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  versions_file="${script_dir}/../config/tool-versions.env"

  if [ ! -r "${versions_file}" ]; then
    printf 'No se puede leer la fuente de versiones: %s\n' "${versions_file}" >&2
    return 2
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    # Git Bash puede recibir el archivo con finales CRLF según core.autocrlf.
    line="${line%$'\r'}"
    case "${line}" in
      '' | \#*) continue ;;
    esac

    if [[ ! "${line}" =~ ^([A-Z][A-Z0-9_]*)=([^[:space:]]+)$ ]]; then
      printf 'Línea inválida en %s: %s\n' "${versions_file}" "${line}" >&2
      return 2
    fi

    name="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    if [ -z "${allowed[${name}]:-}" ]; then
      printf 'Variable de imagen no reconocida en %s: %s\n' "${versions_file}" "${name}" >&2
      return 2
    fi
    if [ -n "${seen[${name}]:-}" ]; then
      printf 'Variable duplicada en %s: %s\n' "${versions_file}" "${name}" >&2
      return 2
    fi

    if [[ "${value}" =~ [^A-Za-z0-9._/@:+-] ]]; then
      printf 'La imagen %s contiene caracteres inválidos: %s\n' "${name}" "${value}" >&2
      return 2
    fi

    case "${value}" in
      *:latest | latest)
        printf 'La imagen %s no puede usar latest.\n' "${name}" >&2
        return 2
        ;;
    esac
    if [[ "${value}" != *@sha256:* && "${value##*/}" != *:* ]]; then
      printf 'La imagen %s debe tener tag o digest fijo: %s\n' "${name}" "${value}" >&2
      return 2
    fi

    seen["${name}"]=1
    printf -v "${name}" '%s' "${value}"
    export "${name}"
  done < "${versions_file}"

  for expected_name in "${expected[@]}"; do
    if [ -z "${seen[${expected_name}]:-}" ]; then
      printf 'Falta %s en %s.\n' "${expected_name}" "${versions_file}" >&2
      return 2
    fi
  done
  if [ "${#seen[@]}" -ne "${#expected[@]}" ]; then
    printf 'Hay variables de imagen no reconocidas en %s.\n' "${versions_file}" >&2
    return 2
  fi
}

_load_security_tool_versions
_security_versions_status=$?
unset -f _load_security_tool_versions
if [ "${_security_versions_status}" -ne 0 ]; then
  return "${_security_versions_status}" 2>/dev/null || exit "${_security_versions_status}"
fi
unset _security_versions_status

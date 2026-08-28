#!/usr/bin/env python3
"""Valida el archivo de excepciones de seguridad.

Falla (codigo 1) si:
  - una excepcion esta vencida;
  - falta cualquiera de los ocho campos obligatorios;
  - hay comodines o justificaciones vacias;
  - la ventana entre `created` y `expires` supera el maximo permitido;
  - hay identificadores duplicados.

Se ejecuta en cada PR. Una excepcion vencida rompe el build a proposito: es el
mecanismo que impide que una deuda de seguridad se vuelva permanente por
inercia.

Uso:
  python3 security/scripts/validate-exceptions.py [ruta_yml]

No requiere PyYAML: el archivo tiene una estructura acotada y se parsea con un
lector propio para que el script corra en cualquier runner sin instalar nada.
"""
from __future__ import annotations

import datetime as dt
import re
import sys
from pathlib import Path

REQUIRED_FIELDS = (
    "id",
    "tool",
    "finding",
    "reason",
    "compensating_control",
    "owner",
    "created",
    "expires",
)
VALID_TOOLS = {
    "semgrep",
    "trivy",
    "osv",
    "gitleaks",
    "zap",
    "nuclei",
    "testssl",
    "codeql",
}
MAX_WINDOW_DAYS = 90
FORBIDDEN_VALUES = {"*", "all", "any", "todo", "tbd", "-", "n/a", "na"}
ID_PATTERN = re.compile(r"^SEC-EXC-\d{3,}$")


class ExceptionsError(Exception):
    """Error de formato o de politica en el archivo de excepciones."""


def parse_exceptions(text: str) -> list[dict[str, str]]:
    """Lee la lista `exceptions:` con soporte para escalares y bloques `>-`."""
    entries: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    pending_key: str | None = None
    pending_lines: list[str] = []
    in_exceptions = False

    def flush_block() -> None:
        nonlocal pending_key, pending_lines
        if current is not None and pending_key is not None:
            current[pending_key] = " ".join(pending_lines).strip()
        pending_key, pending_lines = None, []

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()

        if not in_exceptions:
            if stripped == "exceptions:":
                in_exceptions = True
            continue
        if not stripped or stripped.startswith("#"):
            continue

        indent = len(line) - len(line.lstrip())

        if pending_key is not None:
            # Las lineas del bloque estan mas indentadas que su clave.
            if indent > pending_indent:
                pending_lines.append(stripped)
                continue
            flush_block()

        if stripped.startswith("- "):
            if current:
                entries.append(current)
            current = {}
            stripped = stripped[2:].strip()
            indent += 2

        if not stripped or current is None:
            continue

        key, _, value = stripped.partition(":")
        key, value = key.strip(), value.strip()
        if not key:
            continue

        if value in (">-", ">", "|", "|-"):
            pending_key = key
            pending_indent = indent
            pending_lines = []
            continue

        current[key] = value.strip("'\"")

    flush_block()
    if current:
        entries.append(current)
    return entries


def parse_date(value: str, field: str, exception_id: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as error:
        raise ExceptionsError(
            f"{exception_id}: `{field}` no es una fecha AAAA-MM-DD valida ({value!r})."
        ) from error


def validate(entries: list[dict[str, str]], today: dt.date) -> list[str]:
    problems: list[str] = []
    seen_ids: set[str] = set()

    for index, entry in enumerate(entries, start=1):
        exception_id = entry.get("id", f"<sin id, posicion {index}>")

        missing = [field for field in REQUIRED_FIELDS if not entry.get(field)]
        if missing:
            problems.append(
                f"{exception_id}: faltan campos obligatorios: {', '.join(missing)}."
            )
            continue

        if not ID_PATTERN.match(entry["id"]):
            problems.append(
                f"{exception_id}: el id debe tener el formato SEC-EXC-NNN."
            )
        if entry["id"] in seen_ids:
            problems.append(f"{exception_id}: id duplicado.")
        seen_ids.add(entry["id"])

        if entry["tool"].lower() not in VALID_TOOLS:
            problems.append(
                f"{exception_id}: herramienta desconocida {entry['tool']!r}. "
                f"Validas: {', '.join(sorted(VALID_TOOLS))}."
            )

        for field in ("finding", "reason", "compensating_control", "owner"):
            value = entry[field].strip()
            if value.lower() in FORBIDDEN_VALUES or "*" in value and field == "finding":
                problems.append(
                    f"{exception_id}: `{field}` no admite comodines ni valores vacios "
                    f"({value!r}). Una excepcion sin alcance concreto no es una excepcion."
                )
            if field in ("reason", "compensating_control") and len(value) < 25:
                problems.append(
                    f"{exception_id}: `{field}` es demasiado breve para justificar "
                    "una excepcion; describi el motivo y el control real."
                )

        created = parse_date(entry["created"], "created", exception_id)
        expires = parse_date(entry["expires"], "expires", exception_id)

        if expires <= created:
            problems.append(
                f"{exception_id}: `expires` debe ser posterior a `created`."
            )
        elif (expires - created).days > MAX_WINDOW_DAYS:
            problems.append(
                f"{exception_id}: la ventana es de {(expires - created).days} dias; "
                f"el maximo es {MAX_WINDOW_DAYS}."
            )

        if expires < today:
            problems.append(
                f"{exception_id}: VENCIDA el {expires.isoformat()} "
                f"({(today - expires).days} dias). Resolve el hallazgo o renova la "
                "excepcion con una justificacion actualizada."
            )

    return problems


def main() -> int:
    path = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else "security/exceptions/security-exceptions.yml"
    )
    if not path.is_file():
        print(f"ERROR: no existe {path}", file=sys.stderr)
        return 1

    text = path.read_text(encoding="utf-8")

    # Se ignoran los comentarios: la documentacion del propio archivo cita el
    # patron prohibido para explicar que no se admite.
    code_lines = [
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    ]
    if re.search(r'ignore:\s*["\']?\*', "\n".join(code_lines)):
        print('ERROR: `ignore: "*"` esta prohibido.', file=sys.stderr)
        return 1

    try:
        entries = parse_exceptions(text)
    except ExceptionsError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    today = dt.date.today()
    problems = validate(entries, today)

    active = sum(
        1
        for entry in entries
        if entry.get("expires")
        and dt.date.fromisoformat(entry["expires"]) >= today
    )
    expired = len(entries) - active

    print(f"Excepciones declaradas : {len(entries)}")
    print(f"  activas              : {active}")
    print(f"  vencidas             : {expired}")

    for entry in entries:
        if not entry.get("expires"):
            continue
        expires = dt.date.fromisoformat(entry["expires"])
        remaining = (expires - today).days
        state = "VENCIDA" if remaining < 0 else f"vence en {remaining} dias"
        if 0 <= remaining <= 14:
            state += "  <-- renovar o resolver pronto"
        print(f"  - {entry.get('id')} [{entry.get('tool')}] {state}")

    if problems:
        print("\nPROBLEMAS ENCONTRADOS:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print("\nTodas las excepciones son validas y estan vigentes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

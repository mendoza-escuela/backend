#!/usr/bin/env python3
"""Consolida los informes de seguridad y aplica la politica de gates.

Lee lo que exista en security/reports/, cuenta hallazgos por severidad y
escribe security/reports/summary.md con el veredicto final.

Un informe ausente NO se cuenta como aprobado: se marca NOT_EXECUTED. La
diferencia importa, porque "no se ejecuto" y "no encontro nada" son cosas
distintas ante una revision formal.

Politica (documentada en docs/security/SECURITY_TESTING.md):

  FAIL                  secretos reales; CRITICAL sin excepcion vigente;
                        HIGH nuevos respecto del baseline; ZAP High;
                        excepciones vencidas; herramienta que debia correr y fallo.
  PASS WITH WARNINGS    MEDIUM/LOW; HIGH ya presentes en el baseline;
                        hallazgos informativos.
  PASS                  nada de lo anterior.

Uso:
  python3 security/scripts/summarize.py [--reports DIR] [--baseline ARCHIVO]
                                        [--project NOMBRE] [--strict-high]
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")


def read_json(path: Path) -> Any | None:
    if not path.is_file() or path.stat().st_size == 0:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError:
        return None


def read_jsonl(path: Path) -> list[dict] | None:
    """Nuclei escribe una linea JSON por hallazgo.

    Un archivo que EXISTE pero esta vacio significa "se ejecuto y no encontro
    nada", que es distinto de "no se ejecuto". Devolver None en ese caso hacia
    que un escaneo limpio apareciera como NOT_EXECUTED y subestimara la
    cobertura real del pipeline.
    """
    if not path.is_file():
        return None
    if path.stat().st_size == 0:
        return []
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def empty_counts() -> dict[str, int]:
    return {severity: 0 for severity in SEVERITIES}


class ToolResult:
    def __init__(self, name: str) -> None:
        self.name = name
        self.executed = False
        self.counts = empty_counts()
        self.total = 0
        self.note = ""
        self.findings: list[dict] = []

    @property
    def status(self) -> str:
        return "EJECUTADO" if self.executed else "NOT_EXECUTED"


# ---------------------------------------------------------------------------
# Parsers por herramienta
# ---------------------------------------------------------------------------

def parse_semgrep(path: Path) -> ToolResult:
    result = ToolResult("Semgrep")
    data = read_json(path)
    if data is None:
        return result
    result.executed = True

    # Semgrep usa ERROR/WARNING/INFO. Se eleva a CRITICAL cuando la regla
    # declara impacto alto en su metadata.
    for finding in data.get("results", []):
        extra = finding.get("extra", {})
        metadata = extra.get("metadata", {})
        severity = str(extra.get("severity", "INFO")).upper()
        impact = str(metadata.get("impact", "")).upper()

        if severity == "ERROR" and impact == "HIGH":
            bucket = "CRITICAL"
        elif severity == "ERROR":
            bucket = "HIGH"
        elif severity == "WARNING":
            bucket = "MEDIUM"
        else:
            bucket = "LOW"

        result.counts[bucket] += 1
        result.total += 1
        result.findings.append(
            {
                "id": finding.get("check_id", "sin-regla"),
                "severity": bucket,
                "location": f"{finding.get('path', '?')}:{finding.get('start', {}).get('line', '?')}",
                "message": extra.get("message", "").strip().split("\n")[0][:160],
            }
        )

    errors = data.get("errors", [])
    if errors:
        result.note = f"{len(errors)} error(es) de parseo reportados por Semgrep"
    return result


def parse_trivy(path: Path, label: str) -> ToolResult:
    result = ToolResult(label)
    data = read_json(path)
    if data is None:
        return result
    result.executed = True

    for entry in data.get("Results") or []:
        target = entry.get("Target", "?")
        for vulnerability in entry.get("Vulnerabilities") or []:
            severity = str(vulnerability.get("Severity", "UNKNOWN")).upper()
            if severity not in result.counts:
                continue
            result.counts[severity] += 1
            result.total += 1
            result.findings.append(
                {
                    "id": vulnerability.get("VulnerabilityID", "?"),
                    "severity": severity,
                    "location": f"{target}:{vulnerability.get('PkgName', '?')}",
                    "message": (
                        f"{vulnerability.get('PkgName', '?')} "
                        f"{vulnerability.get('InstalledVersion', '?')} -> "
                        f"{vulnerability.get('FixedVersion') or 'SIN FIX DISPONIBLE'}"
                    ),
                    "fixed": bool(vulnerability.get("FixedVersion")),
                }
            )
        for misconfig in entry.get("Misconfigurations") or []:
            severity = str(misconfig.get("Severity", "UNKNOWN")).upper()
            if severity not in result.counts:
                continue
            result.counts[severity] += 1
            result.total += 1
            result.findings.append(
                {
                    "id": misconfig.get("ID", "?"),
                    "severity": severity,
                    "location": target,
                    "message": misconfig.get("Title", "")[:160],
                }
            )
    return result


def parse_osv(path: Path) -> ToolResult:
    result = ToolResult("OSV-Scanner")
    data = read_json(path)
    if data is None:
        return result
    result.executed = True

    def cvss_bucket(score: float) -> str:
        if score >= 9.0:
            return "CRITICAL"
        if score >= 7.0:
            return "HIGH"
        if score >= 4.0:
            return "MEDIUM"
        return "LOW"

    for entry in data.get("results", []):
        source = entry.get("source", {}).get("path", "?")
        for package in entry.get("packages", []):
            package_name = package.get("package", {}).get("name", "?")
            severity_by_id: dict[str, str] = {}
            for group in package.get("groups", []):
                max_severity = group.get("max_severity")
                bucket = "MEDIUM"
                if max_severity:
                    try:
                        bucket = cvss_bucket(float(max_severity))
                    except (TypeError, ValueError):
                        bucket = "MEDIUM"
                for identifier in group.get("ids", []):
                    severity_by_id[identifier] = bucket

            for vulnerability in package.get("vulnerabilities", []):
                identifier = vulnerability.get("id", "?")
                bucket = severity_by_id.get(identifier, "MEDIUM")
                result.counts[bucket] += 1
                result.total += 1
                result.findings.append(
                    {
                        "id": identifier,
                        "severity": bucket,
                        "location": f"{os.path.basename(source)}:{package_name}",
                        "message": (vulnerability.get("summary") or "")[:160],
                    }
                )
    return result


def parse_gitleaks(path: Path) -> ToolResult:
    result = ToolResult("Gitleaks")
    data = read_json(path)
    if data is None:
        return result
    result.executed = True
    if not isinstance(data, list):
        return result

    for finding in data:
        # Todo secreto detectado es CRITICAL: no hay fugas "leves".
        result.counts["CRITICAL"] += 1
        result.total += 1
        result.findings.append(
            {
                "id": finding.get("RuleID", "?"),
                "severity": "CRITICAL",
                "location": f"{finding.get('File', '?')}:{finding.get('StartLine', '?')}",
                # Nunca se imprime el secreto, ni siquiera redactado.
                "message": f"commit {str(finding.get('Commit', ''))[:8]} — {finding.get('Description', '')[:100]}",
            }
        )
    return result


def parse_zap(path: Path) -> ToolResult:
    result = ToolResult("OWASP ZAP")
    data = read_json(path)
    if data is None:
        return result
    result.executed = True

    risk_map = {"3": "HIGH", "2": "MEDIUM", "1": "LOW", "0": "LOW"}
    for site in data.get("site", []):
        for alert in site.get("alerts", []):
            bucket = risk_map.get(str(alert.get("riskcode", "0")), "LOW")
            instances = len(alert.get("instances", [])) or 1
            result.counts[bucket] += instances
            result.total += instances
            result.findings.append(
                {
                    "id": alert.get("pluginid", "?"),
                    "severity": bucket,
                    "location": site.get("@name", "?"),
                    "message": f"{alert.get('alert', '')} ({instances} instancia/s)",
                }
            )
    return result


def parse_nuclei(path: Path) -> ToolResult:
    result = ToolResult("Nuclei")
    rows = read_jsonl(path)
    if rows is None:
        return result
    result.executed = True

    mapping = {
        "critical": "CRITICAL",
        "high": "HIGH",
        "medium": "MEDIUM",
        "low": "LOW",
        "info": "LOW",
        "unknown": "LOW",
    }
    for row in rows:
        info = row.get("info", {})
        bucket = mapping.get(str(info.get("severity", "info")).lower(), "LOW")
        result.counts[bucket] += 1
        result.total += 1
        result.findings.append(
            {
                "id": row.get("template-id", "?"),
                "severity": bucket,
                "location": row.get("matched-at", row.get("host", "?")),
                "message": (info.get("name") or "")[:160],
            }
        )
    return result


# ---------------------------------------------------------------------------
# Excepciones y baseline
# ---------------------------------------------------------------------------

def load_exceptions(path: Path) -> tuple[int, int, set[str]]:
    """Devuelve (activas, vencidas, findings_cubiertos)."""
    if not path.is_file():
        return 0, 0, set()

    today = dt.date.today()
    active = expired = 0
    covered: set[str] = set()
    current: dict[str, str] = {}

    def close(entry: dict[str, str]) -> None:
        nonlocal active, expired
        if not entry.get("expires"):
            return
        try:
            expires = dt.date.fromisoformat(entry["expires"])
        except ValueError:
            return
        if expires >= today:
            active += 1
            if entry.get("finding"):
                covered.add(entry["finding"].strip())
        else:
            expired += 1

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("- "):
            if current:
                close(current)
            current = {}
            line = line[2:].strip()
        key, sep, value = line.partition(":")
        if sep and value.strip() and value.strip() not in (">-", ">", "|", "|-"):
            current[key.strip()] = value.strip().strip("'\"")
    if current:
        close(current)

    return active, expired, covered


def load_baseline(path: Path | None) -> set[str]:
    if path is None or not path.is_file():
        return set()
    data = read_json(path)
    if not isinstance(data, dict):
        return set()
    return set(data.get("known_findings", []))


# ---------------------------------------------------------------------------
# Informe
# ---------------------------------------------------------------------------

def git_value(repo: Path, *args: str) -> str:
    try:
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        ).stdout.strip() or "desconocido"
    except (OSError, subprocess.SubprocessError):
        return "desconocido"


def tool_versions(config_dir: Path) -> list[str]:
    versions_file = config_dir / "tool-versions.env"
    if not versions_file.is_file():
        return []
    versions = []
    for line in versions_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            versions.append(line.split("=", 1)[1])
    return versions


def severity_row(name: str, result: ToolResult) -> str:
    if not result.executed:
        return f"| {name} | NOT_EXECUTED | - | - | - | - |"
    return (
        f"| {name} | {result.status} | {result.counts['CRITICAL']} | "
        f"{result.counts['HIGH']} | {result.counts['MEDIUM']} | {result.counts['LOW']} |"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports", default="security/reports")
    parser.add_argument("--config", default="security/config")
    parser.add_argument("--exceptions", default="security/exceptions/security-exceptions.yml")
    parser.add_argument("--baseline", default=None)
    parser.add_argument("--project", default=None)
    # git no existe dentro del contenedor donde suele correr este script: el
    # wrapper los resuelve en el host y los pasa por parametro. Sin esto el
    # informe sale con "desconocido" y pierde trazabilidad.
    parser.add_argument("--commit", default=None)
    parser.add_argument("--branch", default=None)
    parser.add_argument(
        "--strict-high",
        action="store_true",
        help="Trata cualquier HIGH como bloqueante, no solo los nuevos.",
    )
    args = parser.parse_args()

    reports_dir = Path(args.reports)
    repo_root = reports_dir.parent.parent
    project = args.project or repo_root.resolve().name

    results = {
        "semgrep": parse_semgrep(reports_dir / "semgrep.json"),
        "trivy_fs": parse_trivy(reports_dir / "trivy-fs.json", "Trivy FS"),
        "osv": parse_osv(reports_dir / "osv.json"),
        "gitleaks": parse_gitleaks(reports_dir / "gitleaks.json"),
        "trivy_backend": parse_trivy(
            reports_dir / "trivy-backend-image.json", "Trivy imagen backend"
        ),
        "trivy_frontend": parse_trivy(
            reports_dir / "trivy-frontend-image.json", "Trivy imagen frontend"
        ),
        "zap": parse_zap(reports_dir / "zap-report.json"),
        "nuclei": parse_nuclei(reports_dir / "nuclei.json"),
    }

    active_exceptions, expired_exceptions, covered = load_exceptions(Path(args.exceptions))
    baseline = load_baseline(Path(args.baseline) if args.baseline else None)

    # -- Politica -----------------------------------------------------------
    blocking: list[str] = []
    warnings: list[str] = []

    secrets = results["gitleaks"]
    if secrets.executed and secrets.total > 0:
        blocking.append(
            f"{secrets.total} secreto(s) detectado(s) por Gitleaks en el historial"
        )

    for key, result in results.items():
        if key == "gitleaks" or not result.executed:
            continue
        criticals = [
            finding
            for finding in result.findings
            if finding["severity"] == "CRITICAL" and finding["id"] not in covered
        ]
        if criticals:
            blocking.append(
                f"{result.name}: {len(criticals)} hallazgo(s) CRITICAL sin excepcion vigente"
            )

        highs = [
            finding
            for finding in result.findings
            if finding["severity"] == "HIGH" and finding["id"] not in covered
        ]
        new_highs = [finding for finding in highs if finding["id"] not in baseline]
        if args.strict_high and highs:
            blocking.append(f"{result.name}: {len(highs)} hallazgo(s) HIGH (modo estricto)")
        elif new_highs:
            blocking.append(
                f"{result.name}: {len(new_highs)} hallazgo(s) HIGH NUEVO(s) respecto del baseline"
            )
        elif highs:
            warnings.append(f"{result.name}: {len(highs)} HIGH ya conocidos en el baseline")

        medium_low = result.counts["MEDIUM"] + result.counts["LOW"]
        if medium_low:
            warnings.append(f"{result.name}: {medium_low} hallazgo(s) MEDIUM/LOW")

    if results["zap"].executed and results["zap"].counts["HIGH"]:
        blocking.append(f"ZAP: {results['zap'].counts['HIGH']} alerta(s) de riesgo alto")

    if expired_exceptions:
        blocking.append(f"{expired_exceptions} excepcion(es) de seguridad VENCIDA(s)")

    verdict = "FAIL" if blocking else ("PASS WITH WARNINGS" if warnings else "PASS")

    # -- Salida -------------------------------------------------------------
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines: list[str] = [
        "# Resumen de seguridad",
        "",
        f"| Campo | Valor |",
        f"| --- | --- |",
        f"| Proyecto | {project} |",
        f"| Commit | `{args.commit or git_value(repo_root, 'rev-parse', 'HEAD')}` |",
        f"| Rama | {args.branch or git_value(repo_root, 'rev-parse', '--abbrev-ref', 'HEAD')} |",
        f"| Fecha | {timestamp} |",
        f"| Resultado | **{verdict}** |",
        "",
        "## Hallazgos por herramienta",
        "",
        "| Herramienta | Estado | Critical | High | Medium | Low |",
        "| --- | --- | --- | --- | --- | --- |",
        severity_row("Semgrep (SAST)", results["semgrep"]),
        severity_row("Trivy FS (dependencias)", results["trivy_fs"]),
        severity_row("OSV-Scanner (dependencias)", results["osv"]),
        severity_row("Trivy imagen backend", results["trivy_backend"]),
        severity_row("Trivy imagen frontend", results["trivy_frontend"]),
        severity_row("OWASP ZAP (DAST)", results["zap"]),
        severity_row("Nuclei (DAST)", results["nuclei"]),
        "",
        "## Secretos",
        "",
        f"- Estado: {results['gitleaks'].status}",
        f"- Hallazgos: {results['gitleaks'].total}",
        "- Los secretos nunca se imprimen: sólo se listan archivo, línea y commit.",
        "",
        "## Excepciones",
        "",
        f"- Activas: {active_exceptions}",
        f"- Vencidas: {expired_exceptions}",
        "",
    ]

    versions = tool_versions(Path(args.config))
    if versions:
        lines += ["## Versiones de herramientas", ""]
        lines += [f"- `{version}`" for version in versions]
        lines.append("")

    if blocking:
        lines += ["## Motivos de bloqueo", ""]
        lines += [f"- {reason}" for reason in blocking]
        lines.append("")

    if warnings:
        lines += ["## Advertencias", ""]
        lines += [f"- {warning}" for warning in warnings]
        lines.append("")

    not_executed = [result.name for result in results.values() if not result.executed]
    if not_executed:
        lines += [
            "## No ejecutado",
            "",
            "Estas herramientas no dejaron informe en esta corrida. "
            "NOT_EXECUTED no equivale a PASS.",
            "",
        ]
        lines += [f"- {name}" for name in not_executed]
        lines.append("")

    top = [
        finding
        for result in results.values()
        for finding in result.findings
        if finding["severity"] in ("CRITICAL", "HIGH")
    ][:25]
    if top:
        lines += [
            "## Hallazgos Critical/High (primeros 25)",
            "",
            "| Severidad | Id | Ubicación | Detalle |",
            "| --- | --- | --- | --- |",
        ]
        for finding in top:
            detail = str(finding["message"]).replace("|", "\\|")
            lines.append(
                f"| {finding['severity']} | `{finding['id']}` | `{finding['location']}` | {detail} |"
            )
        lines.append("")

    summary_path = reports_dir / "summary.md"
    summary_path.write_text("\n".join(lines), encoding="utf-8")

    print("\n".join(lines[:40]))
    print(f"\nResumen completo en {summary_path}")

    return 1 if verdict == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
VERSIONS_FILE = REPO_ROOT / "security/config/tool-versions.env"
EXPECTED_IMAGE_VARIABLES = {
    "PYTHON_IMAGE",
    "SEMGREP_IMAGE",
    "TRIVY_IMAGE",
    "OSV_SCANNER_IMAGE",
    "GITLEAKS_IMAGE",
    "ZAP_IMAGE",
    "NUCLEI_IMAGE",
    "TESTSSL_IMAGE",
    "SECURITY_POSTGRES_IMAGE",
    "SECURITY_NGINX_IMAGE",
}
EXPECTED_SHELL_SCRIPTS = {
    "create-summary.sh",
    "load-tool-versions.sh",
    "run-all.sh",
    "run-container-scan.sh",
    "run-dast.sh",
    "run-static.sh",
    "security-compose.sh",
    "setup-project-npm.sh",
    "wait-for-app.sh",
}
RUNTIME_IMAGE_VARIABLES = {"BACKEND_IMAGE", "FRONTEND_IMAGE"}


def parse_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for raw_line in VERSIONS_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=([^\s]+)", line)
        if not match:
            raise AssertionError(f"Línea inválida en {VERSIONS_FILE}: {raw_line!r}")
        name, value = match.groups()
        if name in versions:
            raise AssertionError(f"Variable duplicada: {name}")
        versions[name] = value
    return versions


def security_files() -> list[Path]:
    files = [
        path
        for path in (REPO_ROOT / "security").rglob("*")
        if path.is_file()
        and "reports" not in path.parts
        and "__pycache__" not in path.parts
        and path.suffix != ".pyc"
    ]
    files.extend((REPO_ROOT / ".github/workflows").glob("*.yml"))
    files.append(REPO_ROOT / "compose.security.yml")
    return files


class SecurityLayoutTests(unittest.TestCase):
    def test_tool_versions_declares_the_complete_fixed_image_set(self) -> None:
        versions = parse_versions()

        self.assertEqual(set(versions), EXPECTED_IMAGE_VARIABLES)
        for name, value in versions.items():
            self.assertNotEqual(value, "latest", name)
            self.assertFalse(value.endswith(":latest"), name)
            self.assertTrue(
                "@sha256:" in value or ":" in value.rsplit("/", 1)[-1],
                f"{name} no tiene tag ni digest fijo: {value}",
            )

    def test_canonical_image_tags_do_not_escape_the_versions_file(self) -> None:
        versions = parse_versions()
        candidates = [
            path
            for path in security_files()
            if path not in {VERSIONS_FILE, Path(__file__).resolve()}
        ]

        leaks: list[str] = []
        for path in candidates:
            text = path.read_text(encoding="utf-8")
            for value in versions.values():
                if value in text:
                    leaks.append(f"{path.relative_to(REPO_ROOT)}: {value}")
        self.assertEqual(leaks, [], "Tags canónicos fuera de tool-versions.env")

    def test_readme_does_not_duplicate_canonical_image_tags(self) -> None:
        readme = (REPO_ROOT / "security/README.md").read_text(encoding="utf-8")
        tags = {
            value.split("@", 1)[1]
            if "@" in value
            else value.rsplit(":", 1)[1]
            for value in parse_versions().values()
        }

        for tag in tags:
            self.assertNotIn(tag, readme, f"Tag duplicado en README: {tag}")

    def test_every_image_variable_is_declared_and_used(self) -> None:
        versions = parse_versions()
        operational_files = [
            path
            for path in security_files()
            if path
            not in {
                VERSIONS_FILE,
                Path(__file__).resolve(),
                REPO_ROOT / "security/scripts/load-tool-versions.sh",
            }
        ]
        combined = "\n".join(path.read_text(encoding="utf-8") for path in operational_files)
        references = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*_IMAGE)(?::[^}]*)?\}", combined))

        unknown = references - set(versions) - RUNTIME_IMAGE_VARIABLES
        self.assertEqual(unknown, set(), f"Variables de imagen sin declarar: {unknown}")
        for name in versions:
            self.assertIn(name, references, f"Variable de imagen huérfana: {name}")

    def test_shell_scripts_match_the_supported_inventory_and_are_referenced(self) -> None:
        scripts_dir = REPO_ROOT / "security/scripts"
        scripts = {path.name for path in scripts_dir.glob("*.sh")}
        self.assertEqual(scripts, EXPECTED_SHELL_SCRIPTS)

        reference_files = security_files()
        for script_name in scripts:
            script_path = scripts_dir / script_name
            references = "\n".join(
                path.read_text(encoding="utf-8")
                for path in reference_files
                if path not in {script_path, Path(__file__).resolve()}
            )
            self.assertIn(script_name, references, f"Script huérfano: {script_name}")

    def test_shell_scripts_only_load_versions_through_the_helper(self) -> None:
        helper = REPO_ROOT / "security/scripts/load-tool-versions.sh"
        offenders = []
        for path in (REPO_ROOT / "security/scripts").glob("*.sh"):
            if path == helper:
                continue
            text = path.read_text(encoding="utf-8")
            if "tool-versions.env" in text:
                offenders.append(path.name)
            if "load-tool-versions.sh" in text:
                self.assertIn(
                    'load-tool-versions.sh" || exit $?',
                    text,
                    f"{path.name} no propaga el error del helper",
                )
        self.assertEqual(offenders, [])

    def test_invalid_versions_stop_a_caller_before_docker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            scripts_dir = temporary_root / "security/scripts"
            config_dir = temporary_root / "security/config"
            stub_dir = temporary_root / "stub-bin"
            scripts_dir.mkdir(parents=True)
            config_dir.mkdir(parents=True)
            stub_dir.mkdir()

            for script_name in ("load-tool-versions.sh", "run-static.sh"):
                shutil.copy2(
                    REPO_ROOT / "security/scripts" / script_name,
                    scripts_dir / script_name,
                )
            (config_dir / "tool-versions.env").write_text(
                VERSIONS_FILE.read_text(encoding="utf-8")
                + "\nTRIVY_IMAGE=example.invalid/trivy:duplicate\n",
                encoding="utf-8",
            )

            docker_marker = temporary_root / "docker-was-called"
            docker_stub = stub_dir / "docker"
            docker_stub.write_text(
                '#!/usr/bin/env bash\n: > "${DOCKER_MARKER}"\n',
                encoding="utf-8",
            )
            docker_stub.chmod(0o755)
            environment = {
                **os.environ,
                "DOCKER_MARKER": str(docker_marker),
                "PATH": f"{stub_dir}{os.pathsep}{os.environ['PATH']}",
            }

            completed = subprocess.run(
                ["bash", str(scripts_dir / "run-static.sh")],
                cwd=temporary_root,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 2, completed.stderr)
            self.assertIn("Variable duplicada", completed.stderr)
            self.assertFalse(docker_marker.exists(), "Docker no debe ejecutarse")

    def test_unknown_variable_is_rejected_before_export(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            scripts_dir = temporary_root / "security/scripts"
            config_dir = temporary_root / "security/config"
            scripts_dir.mkdir(parents=True)
            config_dir.mkdir(parents=True)
            shutil.copy2(
                REPO_ROOT / "security/scripts/load-tool-versions.sh",
                scripts_dir / "load-tool-versions.sh",
            )
            (config_dir / "tool-versions.env").write_text(
                VERSIONS_FILE.read_text(encoding="utf-8")
                + "\nPATH=/tmp/untrusted:tag\n",
                encoding="utf-8",
            )

            original_path = os.environ["PATH"]
            completed = subprocess.run(
                [
                    "/usr/bin/bash",
                    "-c",
                    'source "$1"; status=$?; printf "%s" "$PATH"; exit "$status"',
                    "bash",
                    str(scripts_dir / "load-tool-versions.sh"),
                ],
                cwd=temporary_root,
                env={**os.environ, "PATH": original_path},
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 2, completed.stderr)
            self.assertIn("Variable de imagen no reconocida", completed.stderr)
            self.assertEqual(completed.stdout, original_path)

    def test_workflows_derive_npm_from_package_manager(self) -> None:
        for workflow in (REPO_ROOT / ".github/workflows").glob("*.yml"):
            text = workflow.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"npm@[0-9]", workflow.name)
            if "npm ci" in text:
                self.assertIn("security/scripts/setup-project-npm.sh", text, workflow.name)

    def test_security_compose_is_only_called_through_its_wrapper(self) -> None:
        wrapper = REPO_ROOT / "security/scripts/security-compose.sh"
        offenders = []
        for path in security_files():
            if path in {wrapper, Path(__file__).resolve()}:
                continue
            if "docker compose -f compose.security.yml" in path.read_text(encoding="utf-8"):
                offenders.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "summarize.py"


class SummarizeGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.reports = self.root / "reports"
        self.reports.mkdir()

    def write_json(self, name: str, value: object) -> None:
        (self.reports / name).write_text(json.dumps(value), encoding="utf-8")

    def write_artifact(self, name: str) -> None:
        (self.reports / name).write_text("generated\n", encoding="utf-8")

    def add_clean_static_reports(self, include_sbom: bool = True) -> None:
        self.write_json("semgrep.json", {"results": [], "errors": []})
        self.write_json("trivy-fs.json", {"Results": []})
        self.write_json("osv.json", {"results": []})
        self.write_json("gitleaks.json", [])
        if include_sbom:
            self.write_artifact("sbom.cyclonedx.json")

    def add_clean_container_reports(self) -> None:
        self.write_json("trivy-backend-image.json", {"Results": []})
        self.write_json("trivy-frontend-image.json", {"Results": []})
        self.write_json("container-scan-metadata.json", {"backend": {}, "frontend": {}})
        self.write_artifact("sbom-backend-image.cyclonedx.json")

    def add_clean_dast_reports(self) -> None:
        self.write_json("zap-report.json", {"site": []})
        (self.reports / "nuclei.json").touch()

    def run_summary(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--reports",
                str(self.reports),
                "--config",
                str(self.root / "config"),
                "--exceptions",
                str(self.root / "missing-exceptions.yml"),
                "--project",
                "backend-test",
                "--commit",
                "test-commit",
                "--branch",
                "test-branch",
                *arguments,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def summary(self) -> str:
        return (self.reports / "summary.md").read_text(encoding="utf-8")

    def test_full_suite_fails_when_required_reports_are_absent(self) -> None:
        completed = self.run_summary()

        self.assertEqual(completed.returncode, 1)
        self.assertIn("| Resultado | **FAIL** |", self.summary())
        self.assertIn("Herramientas requeridas sin informe válido", self.summary())

    def test_partial_suite_requires_an_explicit_group(self) -> None:
        completed = self.run_summary("--partial")

        self.assertEqual(completed.returncode, 2)
        self.assertIn("--partial requiere al menos un --require-group", completed.stderr)

    def test_partial_static_suite_fails_when_its_sbom_is_absent(self) -> None:
        self.add_clean_static_reports(include_sbom=False)

        completed = self.run_summary(
            "--partial", "--require-group", "static"
        )

        self.assertEqual(completed.returncode, 1)
        self.assertIn("sbom.cyclonedx.json", self.summary())

    def test_partial_static_suite_passes_and_marks_other_groups_out_of_scope(self) -> None:
        self.add_clean_static_reports()

        completed = self.run_summary(
            "--partial", "--require-group", "static"
        )

        self.assertEqual(completed.returncode, 0)
        self.assertIn("| Resultado | **PASS** |", self.summary())
        self.assertIn("FUERA_DE_ALCANCE", self.summary())
        self.assertNotIn("## No ejecutado", self.summary())

    def test_full_suite_passes_with_every_required_artifact(self) -> None:
        self.add_clean_static_reports()
        self.add_clean_container_reports()
        self.add_clean_dast_reports()

        completed = self.run_summary()

        self.assertEqual(completed.returncode, 0)
        self.assertIn("| Resultado | **PASS** |", self.summary())
        self.assertNotIn("NOT_EXECUTED", self.summary())


if __name__ == "__main__":
    unittest.main()

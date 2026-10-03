"""编辑器分组工作流的发布门禁和运行时快照回归测试。"""

import itertools
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CD = (ROOT / ".github/workflows/cd.yml").read_text(encoding="utf-8")
DESKTOP = (ROOT / ".github/workflows/desktop-build.yml").read_text(encoding="utf-8")


def job(name):
    return re.search(rf"^  {name}:\n(.*?)(?=^  \w+:\n|\Z)", CD, re.M | re.S).group(1)


def snapshot_command():
    step = DESKTOP.split("      - name: Snapshot raw ARM editor runtime\n", 1)[1]
    command = step.split("        run: |\n", 1)[1].split("        working-directory:", 1)[0]
    return "\n".join(line[10:] for line in command.splitlines())


class EditorWorkflowTests(unittest.TestCase):
    def test_release_waits_for_editor_but_ignores_test_failure(self):
        release = job("create_release")
        self.assertIn("needs: [prepare, build, build_macos_arm64, build_android, editor_e2e]", release)
        expression = re.search(r"if: >-\s*\$\{\{(.*?)\}\}", release, re.S).group(1)
        expression = expression.replace("always()", "True").replace("!cancelled()", "not cancelled")
        expression = expression.replace("&&", " and ")
        expression = re.sub(r"needs\.(\w+)\.result", r'results["\1"]', expression)
        expression = " ".join(expression.split())
        states = ["success", "failure", "skipped", "cancelled"]
        for values in itertools.product(states, repeat=5):
            results = dict(zip(["prepare", "build", "build_macos_arm64", "build_android", "editor_e2e"], values))
            for cancelled in [False, True]:
                expected = not cancelled and all(value == "success" for value in values[:4]) and values[4] != "cancelled"
                actual = eval(expression, {"__builtins__": {}}, {"results": results, "cancelled": cancelled})
                self.assertEqual(actual, expected, (results, cancelled))

    def test_independent_editor_runners_and_serial_workers(self):
        editor = job("editor_e2e")
        self.assertIn("needs: [prepare, build_macos_arm64]", editor)
        self.assertIn("fail-fast: false", editor)
        self.assertIn("group: [1, 2]", editor)
        self.assertIn("--workers=1", editor)
        self.assertIn('--workspace="$HOME/SiYuan-Testing"', editor)
        self.assertNotIn("continue-on-error: true\n        run: >-", editor)
        for name in ["Stop editor kernel", "Record editor outcome and collect logs", "Upload editor reports and logs"]:
            self.assertIn(f"- name: {name}\n        if: always()", editor)
        self.assertIn("NOT RUN (test prerequisites did not complete)", editor)

    @unittest.skipUnless(os.name == "posix" and all(shutil.which(tool) for tool in ["bash", "node", "tar", "shasum"]),
                         "Snapshot command requires Unix tools")
    def test_snapshot_round_trip_and_checksum(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app = root / "app"
            kernel = app / "kernel-darwin-arm64/SiYuan-Kernel"
            kernel.parent.mkdir(parents=True)
            kernel.write_bytes(b"kernel fixture")
            kernel.chmod(0o755)
            desktop = app / "stage/build/desktop/index.html"
            desktop.parent.mkdir(parents=True)
            desktop.write_text("fixture", encoding="utf-8")
            dependency = app / "node_modules/.pnpm/example/index.js"
            dependency.parent.mkdir(parents=True)
            dependency.write_text("fixture", encoding="utf-8")
            (app / "node_modules/example").symlink_to(".pnpm/example", target_is_directory=True)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            sha = "a" * 40
            for name, value in [("uname", "arm64"), ("git", sha)]:
                executable = bin_dir / name
                executable.write_text(f"#!/bin/sh\nprintf '%s\\n' '{value}'\n", encoding="utf-8")
                executable.chmod(0o755)
            env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "RUNNER_TEMP": str(root / "temp"),
                   "GITHUB_SHA": sha, "TESTING_REF": "b" * 40}
            result = subprocess.run(["bash", "-euo", "pipefail", "-c", snapshot_command()], cwd=root,
                                    env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            runtime = root / "temp/editor-runtime"
            with tarfile.open(runtime / "runtime.tar.gz") as archive:
                self.assertTrue(archive.getmember("app/kernel-darwin-arm64/SiYuan-Kernel").mode & 0o111)
                self.assertEqual(archive.getmember("app/node_modules/example").linkname, ".pnpm/example")
                self.assertEqual(archive.extractfile("app/node_modules/.pnpm/example/index.js").read(), b"fixture")
            check = ["shasum", "-a", "256", "--check", "SHA256SUMS"]
            self.assertEqual(subprocess.run(check, cwd=runtime, capture_output=True).returncode, 0)
            with (runtime / "runtime.tar.gz").open("ab") as archive:
                archive.write(b"tampered")
            self.assertNotEqual(subprocess.run(check, cwd=runtime, capture_output=True).returncode, 0)
            env["TESTING_REF"] = ""
            self.assertNotEqual(subprocess.run(["bash", "-euo", "pipefail", "-c", snapshot_command()],
                                              cwd=root, env=env, capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()

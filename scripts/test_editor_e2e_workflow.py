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
    return re.search(rf"^  {name}:\n(.*?)(?=^  [\w-]+:\n|\Z)", CD, re.M | re.S).group(1)


def snapshot_command():
    step = DESKTOP.split("      - name: Snapshot raw ARM editor runtime\n", 1)[1]
    command = step.split("        run: |\n", 1)[1].split("        working-directory:", 1)[0]
    return "\n".join(line[10:] for line in command.splitlines())


class EditorWorkflowTests(unittest.TestCase):
    def test_windows_kernel_tests_cover_all_packages_with_cgo(self):
        kernel = job("kernel-tests-windows")
        compiler = kernel.split("- name: Set up Windows kernel test compiler\n", 1)[1].split("      - ", 1)[0]
        self.assertIn("uses: msys2/setup-msys2@v2", compiler)
        self.assertIn("msystem: UCRT64", compiler)
        self.assertIn("path-type: inherit", compiler)
        self.assertIn("mingw-w64-ucrt-x86_64-gcc", compiler)
        step = kernel.split("- name: Test all Windows kernel packages\n", 1)[1].split("      - ", 1)[0]
        self.assertIn('run: node ../scripts/test-kernel.mjs --shards 4 --output "${{ runner.temp }}/kernel-test-results"', step)
        self.assertIn("shell: msys2 {0}", step)
        self.assertIn("CGO_ENABLED: 1", step)
        self.assertIn("CC: gcc", step)
        self.assertIn("working-directory: kernel", step)
        self.assertIn("continue-on-error: true", step)

    def test_nonblocking_steps_have_ids_and_always_report_outcomes(self):
        for workflow in [CD, DESKTOP]:
            sections = re.split(r"^  [\w-]+:\n", workflow, flags=re.M)
            for section in sections:
                if "continue-on-error: true" not in section:
                    continue
                for step in re.split(r"^      - ", section, flags=re.M)[1:]:
                    if "continue-on-error: true" in step:
                        self.assertRegex(step, r"(?m)^        id: [\w-]+$")
                report = section.split("- name: Report non-blocking step outcomes\n", 1)[1]
                self.assertIn("if: always()", report)
                self.assertIn("WORKFLOW_STEPS: ${{ toJSON(steps) }}", report)
                self.assertIn("scripts/report-workflow-outcomes.mjs", report)
        self.assertIn("node source/scripts/report-workflow-outcomes.mjs", job("editor_e2e"))

    def test_builds_run_in_parallel_with_frontend_checks(self):
        for name in ["build", "build_macos_arm64", "build_android"]:
            dependencies = re.search(r"needs: \[(.*?)\]", job(name)).group(1).split(", ")
            self.assertEqual(dependencies, ["prepare", "languages", "contracts"], name)
        frontend = job("frontend-tests")
        self.assertIn("needs: prepare", frontend)
        for name, command in [
            ("Test frontend, Electron and packaging scripts", "pnpm test"),
            ("Test editor group selection", "node --test scripts/test-prepare-editor-e2e-groups.mjs"),
        ]:
            step = frontend.split(f"- name: {name}\n", 1)[1].split("      - ", 1)[0]
            self.assertIn("continue-on-error: true", step)
            self.assertIn(f"run: {command}", step)
        ocr = frontend.split("- name: Test OCR build and resource scripts\n", 1)[1].split("      - ", 1)[0]
        self.assertNotIn("continue-on-error", ocr)
        self.assertIn('run: python -m unittest discover -s scripts -p "test_*ocr*.py"', ocr)

    def test_release_waits_for_all_checks_with_existing_failure_rules(self):
        release = job("create_release")
        self.assertIn("needs: [prepare, kernel-tests-linux, kernel-tests-windows, frontend-tests, build, build_macos_arm64, build_android, editor_e2e]", release)
        expression = re.search(r"if: >-\s*\$\{\{(.*?)\}\}", release, re.S).group(1)
        expression = expression.replace("always()", "True").replace("!cancelled()", "not cancelled")
        expression = expression.replace("&&", " and ")
        expression = re.sub(r"needs\.([\w-]+)\.result", r'results["\1"]', expression)
        expression = " ".join(expression.split())
        expression = compile(expression, "release condition", "eval")
        states = ["success", "failure", "skipped", "cancelled"]
        for values in itertools.product(states, repeat=8):
            results = dict(zip(["prepare", "kernel-tests-linux", "kernel-tests-windows", "frontend-tests", "build", "build_macos_arm64", "build_android", "editor_e2e"], values))
            for cancelled in [False, True]:
                expected = not cancelled and all(value == "success" for value in values[:7]) and values[7] != "cancelled"
                actual = eval(expression, {"__builtins__": {}}, {"results": results, "cancelled": cancelled})
                self.assertEqual(actual, expected, (results, cancelled))

    def test_kernel_checks_are_independent_and_keep_native_prerequisites(self):
        contracts = job("contracts")
        frontend = job("frontend-tests")
        self.assertNotIn("Test all kernel packages", contracts)
        self.assertNotIn("Test all Windows kernel packages", frontend)
        for name in ["kernel-tests-linux", "kernel-tests-windows", "frontend-tests"]:
            check = job(name)
            self.assertRegex(check, r"(?m)^    needs: prepare$")
            self.assertIn("contents: read", check)
            self.assertIn("uses: actions/checkout@v6", check)
            self.assertIn("uses: actions/setup-node@v6", check)
            self.assertNotRegex(check, r"(?m)^    continue-on-error:")
        for name in ["kernel-tests-linux", "kernel-tests-windows"]:
            check = job(name)
            self.assertIn("uses: actions/setup-go@v6", check)
            self.assertIn("go-version-file: kernel/go.mod", check)
            self.assertIn("cache-dependency-path: kernel/go.sum", check)
        linux = job("kernel-tests-linux")
        self.assertIn("runs-on: ubuntu-24.04", linux)
        self.assertIn("sudo apt-get install -y strace", linux)
        self.assertIn("python3 scripts/prepare-ocr.py --runtime linux-amd64 --build-worker", linux)
        full = linux.split("- name: Test all kernel packages\n", 1)[1].split("      - ", 1)[0]
        self.assertIn('run: node ../scripts/test-kernel.mjs --shards 4 --output "${{ runner.temp }}/kernel-test-results"', full)
        self.assertIn("continue-on-error: true", full)
        self.assertIn("SIYUAN_OCR_TEST_ASSETS: ${{ github.workspace }}/app/stage/ocr/models", full)
        self.assertIn("SIYUAN_OCR_TEST_LIBRARY: ${{ github.workspace }}/app/stage/ocr/runtime/linux-amd64/libonnxruntime.so", full)
        paths = linux.split("- name: Test path fixtures with custom temporary directories\n", 1)[1].split("      - ", 1)[0]
        self.assertIn("continue-on-error: true", paths)
        self.assertIn(
            'run: go test -tags "fts5 sqlcipher" ./internal/testutil ./util ./model ./server '
            "-run 'Test(PublicDataDir|IsSensitivePath|.*Obsidian|RegisterStaticFileHandlers|StaticFile|WidgetResponseCacheControl|"
            "TemplatesAndExportRequireAdministrator|SnippetPublishAccess|PluginPublish|PublishFile)' -count=1", paths)
        self.assertIn("TMPDIR: /tmp", paths)
        self.assertIn("GOTMPDIR: ${{ runner.temp }}", paths)
        for hard_step in ["Install filesystem fault injection dependency", "Prepare native OCR verification resources"]:
            step = linux.split(f"- name: {hard_step}\n", 1)[1].split("      - ", 1)[0]
            self.assertNotIn("continue-on-error:", step)

    def test_kernel_shard_runner_and_logs_are_checked_on_both_platforms(self):
        for platform in ["linux", "windows"]:
            kernel = job(f"kernel-tests-{platform}")
            self.assertIn("run: node --test scripts/test-kernel.test.mjs", kernel)
            upload = kernel.split("- name: Upload kernel test logs\n", 1)[1].split("      - ", 1)[0]
            self.assertIn("if: always()", upload)
            self.assertIn(f"name: kernel-tests-{platform}", upload)
            self.assertIn("path: ${{ runner.temp }}/kernel-test-results", upload)

    def test_go_cache_and_builds_share_job_level_module_directory(self):
        for build in [DESKTOP.split("jobs:\n  build:\n", 1)[1], job("build_android")]:
            header, steps = build.split("    steps:\n", 1)
            self.assertIn("      GOPATH: ${{ github.workspace }}/go", header)
            self.assertNotIn("GOPATH:", steps)
            setup = steps.split("uses: actions/setup-go@v6", 1)[1].split("      - ", 1)[0]
            self.assertIn("cache: true", setup)
            self.assertIn("cache-dependency-path:", setup)
        self.assertIn('"$GOPATH/bin/gomobile" init', job("build_android"))
        self.assertIn("${{ github.workspace }}\\go\\${{ fromJSON(inputs.config).gobin }}\\goversioninfo", DESKTOP)

    def test_independent_editor_runners_and_serial_workers(self):
        editor = job("editor_e2e")
        self.assertIn("needs: [prepare, build_macos_arm64]", editor)
        self.assertIn("fail-fast: false", editor)
        self.assertIn("group: [1, 2]", editor)
        self.assertIn("--workers=1", editor)
        self.assertIn('--workspace="$HOME/SiYuan-Testing"', editor)
        self.assertNotIn("continue-on-error: true\n        run: >-", editor)
        for name in ["Stop editor kernel", "Record editor outcome and collect logs", "Upload editor reports and logs"]:
            step = editor.split(f"- name: {name}\n", 1)[1].split("      - ", 1)[0]
            self.assertIn("        if: always()", step)
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

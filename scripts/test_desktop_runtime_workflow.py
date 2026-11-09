"""macOS 运行时快照与独立封装恢复契约，仅使用临时合成文件。"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def workflow_command(filename, name):
    workflow = (ROOT / ".github/workflows" / filename).read_text(encoding="utf-8")
    step = workflow.split(f"      - name: {name}\n", 1)[1].split("      - ", 1)[0]
    command = step.split("        run: |\n", 1)[1].split("        working-directory:", 1)[0]
    return "\n".join(line[10:] for line in command.splitlines())


SNAPSHOT = workflow_command("desktop-build.yml", "Snapshot raw macOS runtime")
RESTORE = workflow_command("desktop-package.yml", "Verify and restore macOS runtime")


@unittest.skipUnless(os.name == "posix" and all(shutil.which(tool) for tool in ["bash", "node", "tar", "shasum"]),
                     "Runtime round trip requires Unix tools")
class DesktopRuntimeWorkflowTests(unittest.TestCase):
    def fixture(self, root, arch, testing_sha):
        (root / "kernel").mkdir()
        (root / "bin").mkdir()
        product_sha = "a" * 40
        for name, value in [("uname", "arm64"), ("git", product_sha)]:
            executable = root / "bin" / name
            executable.write_text(f"#!/bin/sh\nprintf '%s\\n' '{value}'\n", encoding="utf-8")
            executable.chmod(0o755)
        kernel_dir = "kernel-darwin" if arch == "amd64" else "kernel-darwin-arm64"
        for relative in [f"{kernel_dir}/SiYuan-Kernel", "stage/build/desktop/index.html",
                         "stage/build/markdown/index.html", "stage/protyle/js/lute/lute.min.js",
                         "node_modules/.pnpm/example/index.js"]:
            file = root / "app" / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("synthetic fixture", encoding="utf-8")
        kernel = root / "app" / kernel_dir / "SiYuan-Kernel"
        kernel.chmod(0o755)
        (root / "app/node_modules/example").symlink_to(".pnpm/example", target_is_directory=True)
        return {
            **os.environ, "PATH": f"{root / 'bin'}:{os.environ['PATH']}",
            "RUNNER_TEMP": str(root / "temp"), "TARGET_OS": "darwin", "TARGET_ARCH": arch,
            "TESTING_REF": testing_sha, "GITHUB_SHA": product_sha,
            "KERNEL_PATH": f"../app/{kernel_dir}/SiYuan-Kernel",
        }, kernel

    def execute(self, root, command, env):
        return subprocess.run(["bash", "-euo", "pipefail", "-c", command], cwd=root,
                              env=env, capture_output=True, text=True)

    def test_round_trip_and_rejection_before_replacing_app(self):
        for arch in ["amd64", "arm64"]:
            for testing_sha in ["", "b" * 40]:
                with self.subTest(arch=arch, testing_sha=testing_sha), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    env, kernel = self.fixture(root, arch, testing_sha)
                    result = self.execute(root, SNAPSHOT, env)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    stale = root / "app/stale-checkout-file"
                    stale.write_text("not in snapshot", encoding="utf-8")
                    result = self.execute(root, RESTORE, env)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertFalse(stale.exists())
                    self.assertTrue(kernel.stat().st_mode & 0o111)
                    link = root / "app/node_modules/example"
                    self.assertTrue(link.is_symlink())
                    self.assertEqual(os.readlink(link), ".pnpm/example")
                    self.assertEqual((link / "index.js").read_text(encoding="utf-8"), "synthetic fixture")
                    # 校验失败必须发生在移除 app 之前。
                    stale.write_text("preserve on validation failure", encoding="utf-8")
                    for key, value in [("GITHUB_SHA", "c" * 40), ("TESTING_REF", "c" * 40),
                                       ("TESTING_REF", "invalid"), ("TARGET_OS", "linux"),
                                       ("TARGET_ARCH", "arm64" if arch == "amd64" else "amd64"),
                                       ("TARGET_ARCH", "unknown")]:
                        with self.subTest(mismatch=key, value=value):
                            result = self.execute(root, RESTORE, {**env, key: value})
                            self.assertNotEqual(result.returncode, 0, result.stdout)
                            self.assertTrue(stale.exists())
                    with (root / "temp/desktop-runtime/runtime.tar.gz").open("ab") as archive:
                        archive.write(b"tampered")
                    self.assertNotEqual(self.execute(root, RESTORE, env).returncode, 0)
                    self.assertTrue(stale.exists())

    def test_snapshot_rejects_invalid_inputs(self):
        for key, value in [("GITHUB_SHA", "c" * 40), ("TESTING_REF", "invalid"),
                           ("TARGET_ARCH", "unknown"), ("TARGET_OS", "linux")]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                env, _ = self.fixture(root, "arm64", "b" * 40)
                self.assertNotEqual(self.execute(root, SNAPSHOT, {**env, key: value}).returncode, 0)
                self.assertFalse((root / "temp/desktop-runtime/runtime.tar.gz").exists())


if __name__ == "__main__":
    unittest.main()

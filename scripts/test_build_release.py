"""发布编排回归测试，使用模拟构建产物，不调用编译器或签名密钥。"""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location("build_release", Path(__file__).with_name("build-release.py"))
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


def kernel(version="3.8.4", architecture="arm64"):
    header = bytearray(64)
    header[:6] = b"\x7fELF\x02\x01"
    struct.pack_into("<H", header, 18, 183 if architecture == "arm64" else 62)
    return bytes(header) + f"SiYuan v{version} (pdfcpu ".encode("ascii")


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.args = build.parser().parse_args([])
        self.args.android_dir = self.root / "android"
        self.args.harmony_dir = self.root / "harmony"
        self.args.output = self.root / "output"
        self.args.platforms = ["windows", "linux", "android", "harmony"]
        self.builder = build.Builder(self.args, "3.8.4", self.root / "work")
        self.builder.work.mkdir()

    def write(self, path, content=b"data"):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_copy_rejects_destination_escape(self):
        source = self.write(self.root / "input", b"new")
        with self.assertRaises(build.BuildError):
            build.copy_verified(source, self.root / "outside", self.root / "allowed")
        self.assertFalse((self.root / "outside").exists())

    def test_wsl_sync_skips_matching_commit(self):
        with patch.object(self.builder, "wsl", return_value="target") as wsl, patch.object(build, "run") as run:
            self.builder.sync_wsl("target")
        wsl.assert_called_once_with(["git", "rev-parse", "HEAD"], capture=True)
        run.assert_not_called()

    def test_wsl_authentication_precedes_environment_checks(self):
        events = []

        def source_preflight(*args):
            events.append("environment")
            raise build.BuildError("stop before build")

        with patch.object(build, "run", return_value="target"), \
                patch.object(self.builder, "sync_wsl", side_effect=lambda head: events.append("sync")), \
                patch.object(build, "source_preflight", side_effect=source_preflight), \
                patch.object(build, "certificate_thumbprint") as certificate, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(build.BuildError):
                self.builder.preflight()
        self.assertEqual(events, ["sync", "environment"])
        certificate.assert_not_called()

    def test_windows_only_skips_wsl_authentication(self):
        self.args.platforms = ["windows"]
        with patch.object(self.builder, "sync_wsl") as sync, \
                patch.object(build, "source_preflight"), patch.object(build, "certificate_thumbprint"), \
                contextlib.redirect_stdout(io.StringIO()):
            self.builder.preflight()
        sync.assert_not_called()

    def test_wsl_sync_pins_windows_commit(self):
        heads = iter(("old", "target"))

        def wsl(command, capture=False):
            return next(heads) if command == ["git", "rev-parse", "HEAD"] else ""

        with patch.object(self.builder, "wsl", side_effect=wsl) as remote, \
                patch.object(build, "run", side_effect=("", "dev")), contextlib.redirect_stdout(io.StringIO()):
            self.builder.sync_wsl("target")
        self.assertEqual([call.args[0] for call in remote.call_args_list], [
            ["git", "rev-parse", "HEAD"],
            ["git", "status", "--porcelain", "--untracked-files=all"],
            ["git", "fetch", "--no-tags", "origin", "refs/heads/dev"],
            ["git", "merge-base", "--is-ancestor", "target", "FETCH_HEAD"],
            ["git", "merge-base", "--is-ancestor", "HEAD", "target"],
            ["git", "switch", "--detach", "target"],
            ["git", "rev-parse", "HEAD"],
        ])

    def test_wsl_sync_rejects_dirty_worktrees(self):
        for local_status, remote_status in ((" M app/package.json", ""), ("", "?? notes")):
            with self.subTest(local=local_status, remote=remote_status), \
                    patch.object(build, "run", return_value=local_status), \
                    patch.object(self.builder, "wsl", side_effect=("old", remote_status)) as remote:
                with self.assertRaises(build.BuildError):
                    self.builder.sync_wsl("target")
                self.assertFalse(any(call.args[0][1] in ("fetch", "switch") for call in remote.call_args_list))

    def test_wsl_sync_stops_before_checkout_on_fetch_or_ancestry_failure(self):
        for failed in ("fetch", "published", "diverged"):
            def wsl(command, capture=False):
                if command == ["git", "rev-parse", "HEAD"]:
                    return "old"
                if (command[1] == "fetch" and failed == "fetch" or
                        command[1] == "merge-base" and command[3] == "target" and failed == "published" or
                        command[1] == "merge-base" and command[3] == "HEAD" and failed == "diverged"):
                    raise build.BuildError("sync failed")
                return ""

            with self.subTest(failed=failed), patch.object(build, "run", side_effect=("", "dev")), \
                    patch.object(self.builder, "wsl", side_effect=wsl) as remote:
                with self.assertRaises(build.BuildError):
                    self.builder.sync_wsl("target")
                self.assertFalse(any(call.args[0][1] == "switch" for call in remote.call_args_list))

    def test_copy_updates_old_file_and_verifies_hash(self):
        source = self.write(self.root / "source", b"new kernel")
        target = self.write(self.root / "target", b"old kernel")
        build.copy_verified(source, target, self.root)
        self.assertEqual(target.read_bytes(), b"new kernel")
        self.assertEqual(list(self.root.glob(".siyuan-copy-*")), [])

    def test_collect_missing_output_fails(self):
        with self.assertRaises(build.BuildError):
            self.builder.collect([self.root / "missing.apk"], "Android", time.time())

    def test_old_kernel_version_is_rejected(self):
        path = self.write(self.root / "libkernel.so", kernel("3.8.3"))
        with self.assertRaises(build.BuildError):
            self.builder.check_kernel(path, "arm64")

    def test_wrong_kernel_architecture_is_rejected(self):
        path = self.write(self.root / "libkernel.so", kernel(architecture="amd64"))
        with self.assertRaises(build.BuildError):
            self.builder.check_kernel(path, "arm64")

    def test_windows_uses_fresh_kernel_directories_and_forces_signing(self):
        root = self.root / "repository"
        for arch in ("amd64", "arm64"):
            self.write(root / "app/elevator" / f"elevator-{arch}.exe")
        self.builder.thumbprint = "A" * 40
        commands = []

        def fake_run(command, cwd, env=None, capture=False):
            command = [str(value) for value in command]
            commands.append(command)
            if command[:3] in (["go", "env", "GOBIN"], ["go", "env", "GOPATH"]):
                return str(self.root / "go-bin")
            if command[:2] == ["go", "build"]:
                self.write(command[command.index("-o") + 1])
            if command[0] == "node":
                Path(command[-1]).write_text(json.dumps({
                    "forceCodeSigning": True, "directories": {"output": command[4]},
                    "win": {"extraResources": [{"from": command[3], "to": "kernel"}],
                            "signtoolOptions": {"certificateSha1": command[5]}},
                }), encoding="utf-8")
            if command[:3] == ["pnpm", "exec", "electron-builder"]:
                config = json.loads(Path(command[command.index("--config") + 1]).read_text(encoding="utf-8"))
                self.assertTrue(config["forceCodeSigning"])
                self.assertEqual(config["win"]["signtoolOptions"]["certificateSha1"], "A" * 40)
                kernel_dir = Path(config["win"]["extraResources"][0]["from"])
                self.assertTrue(kernel_dir.is_relative_to(self.builder.work))
                self.assertEqual({p.name for p in kernel_dir.iterdir()}, {"SiYuan-Kernel.exe", "elevator.exe"})
                suffix = "-arm64" if "--arm64" in command else ""
                self.write(Path(config["directories"]["output"]) / f"siyuan-3.8.4-win{suffix}.exe")
            return ""

        with patch.object(build, "ROOT", root), patch.object(build, "run", side_effect=fake_run), \
                patch.object(build, "verify_signature") as signatures, patch.object(self.builder, "check_kernel"):
            self.builder.windows()
        self.assertEqual(len(self.builder.artifacts), 2)
        self.assertEqual(signatures.call_count, 2)
        self.assertFalse((root / "app/kernel").exists())

    @unittest.skipUnless(shutil.which("node") and (build.ROOT / "app/node_modules/electron-builder").exists(),
                         "需要已安装的 Electron Builder，仅加载配置，不执行构建")
    def test_installed_builder_configuration_excludes_old_kernel(self):
        destination = self.root / "windows.json"
        with contextlib.redirect_stdout(io.StringIO()):
            build.run(["node", build.ROOT / "scripts/release-windows-config.cjs",
                       build.ROOT / "app/electron-builder.yml", self.root / "new-kernel",
                       self.root / "build", "A" * 40, destination], build.ROOT / "app", capture=True)
        config = json.loads(destination.read_text(encoding="utf-8"))
        self.assertEqual(config["win"]["extraResources"], [{"from": str(self.root / "new-kernel"), "to": "kernel"}])
        self.assertTrue(config["forceCodeSigning"])
        self.assertNotIn("extends", config)
        self.assertEqual(config["win"]["signtoolOptions"]["signingHashAlgorithms"], ["sha256"])
        self.assertTrue(any(entry.get("to") == "stage" for entry in config["extraResources"]))

    def test_harmony_copies_each_architecture_before_next_build(self):
        remote = self.root / "wsl"
        self.builder.wsl_root = remote
        assets = self.write(self.root / "app.zip", b"current assets")

        def fake_wsl(command, directory=None, capture=False):
            architecture = "arm64" if command[-1] == "build.sh" else "amd64"
            self.write(remote / "kernel/harmony/libkernel.so", kernel(architecture=architecture))
            self.write(remote / "kernel/harmony/libkernel.h", architecture.encode())
            self.write(remote / "kernel/harmony/lan_sync_bridge.h", b"bridge")

        def fake_run(command, cwd, env=None, capture=False):
            if command[-1] == "assembleApp":
                self.assertIn("buildMode=release", command)
                self.write(self.args.harmony_dir / "build/outputs/default/siyuan-harmony-default-unsigned.app")
                self.write(self.args.harmony_dir / "build/outputs/default/siyuan-harmony-default-signed.app", b"signed app")
            return ""

        with patch.object(self.builder, "wsl", side_effect=fake_wsl), patch.object(build, "run", side_effect=fake_run):
            self.builder.harmony(assets)
        arm = self.args.harmony_dir / "entry/libs/arm64-v8a/libkernel.so"
        amd = self.args.harmony_dir / "entry/libs/x86_64/libkernel.so"
        self.assertEqual(arm.read_bytes(), kernel(architecture="arm64"))
        self.assertEqual(amd.read_bytes(), kernel(architecture="amd64"))
        self.assertEqual([path.name for path in self.builder.artifacts], ["siyuan-harmony-default-signed.app"])
        self.assertEqual(self.builder.artifacts[0].read_bytes(), b"signed app")
        self.assertEqual((self.args.harmony_dir / "entry/src/main/cpp/include/libkernel.h").read_bytes(), b"arm64")
        self.assertEqual((self.args.harmony_dir / "entry/src/main/cpp/include/lan_sync_bridge.h").read_bytes(), b"bridge")
        for abi in ("arm64-v8a", "x86_64"):
            self.assertEqual({path.name for path in (self.args.harmony_dir / "entry/libs" / abi).iterdir()},
                             {"libkernel.so"})

    def test_harmony_rejects_unsigned_only_output(self):
        self.builder.wsl_root = self.root / "wsl"
        assets = self.write(self.root / "app.zip")
        bridge = self.write(self.args.harmony_dir / "entry/src/main/cpp/include/lan_sync_bridge.h", b"maintained bridge")

        def fake_wsl(command, directory=None, capture=False):
            architecture = "arm64" if command[-1] == "build.sh" else "amd64"
            self.write(self.builder.wsl_root / "kernel/harmony/libkernel.so", kernel(architecture=architecture))
            self.write(self.builder.wsl_root / "kernel/harmony/libkernel.h")

        def fake_run(command, cwd, env=None, capture=False):
            if command[-1] == "assembleApp":
                self.write(self.args.harmony_dir / "build/outputs/default/siyuan-harmony-default-unsigned.app")
            return ""

        with patch.object(self.builder, "wsl", side_effect=fake_wsl), patch.object(build, "run", side_effect=fake_run):
            with self.assertRaises(build.BuildError):
                self.builder.harmony(assets)
        self.assertEqual(self.builder.artifacts, [])
        self.assertEqual(bridge.read_bytes(), b"maintained bridge")

    def test_harmony_missing_generated_header_stops_packaging(self):
        self.builder.wsl_root = self.root / "wsl"
        assets = self.write(self.root / "app.zip")

        def fake_wsl(command, directory=None, capture=False):
            self.write(self.builder.wsl_root / "kernel/harmony/libkernel.so", kernel())

        with patch.object(self.builder, "wsl", side_effect=fake_wsl), patch.object(build, "run") as run:
            with self.assertRaisesRegex(build.BuildError, "头文件未更新"):
                self.builder.harmony(assets)
            run.assert_not_called()

    def test_android_new_aar_is_copied_before_gradle(self):
        sdk = self.root / "sdk"
        (sdk / "ndk/27.0.1").mkdir(parents=True)
        assets = self.write(self.root / "app.zip", b"new assets")
        old = self.write(self.args.android_dir / "app/libs/kernel.aar", b"old aar")
        self.write(self.args.android_dir / "local.properties", f"sdk.dir={sdk.as_posix()}\n".encode("utf-8"))

        def fake_run(command, cwd, env=None, capture=False):
            command = [str(value) for value in command]
            if command[0] == "gomobile":
                with zipfile.ZipFile(command[command.index("-o") + 1], "w") as archive:
                    archive.writestr("jni/arm64-v8a/libgojni.so", kernel())
            if command[0].endswith("gradlew.bat"):
                self.assertNotEqual(old.read_bytes(), b"old aar")
                self.assertEqual((self.args.android_dir / "app/src/main/assets/app.zip").read_bytes(), b"new assets")
                self.assertIn("buildReleaseTask", command)
                for channel, ext in (("cn", "apk"), ("official", "apk"), ("googleplay", "aab"), ("huawei", "aab")):
                    self.write(self.args.android_dir / "app/build-release/siyuan-3.8.4-all" / f"siyuan-3.8.4-{channel}-release.{ext}")
            return ""

        with patch.dict(build.os.environ, {"ANDROID_HOME": str(sdk)}, clear=True), patch.object(build, "run", side_effect=fake_run):
            self.builder.android(assets)
        self.assertEqual(len(self.builder.artifacts), 4)
        self.assertEqual({path.name for path in self.builder.artifacts}, {
            "siyuan-3.8.4.apk", "siyuan-3.8.4-cn-release.apk",
            "siyuan-3.8.4-googleplay-release.aab", "siyuan-3.8.4-huawei-release.aab",
        })

    def test_finish_only_prints_manual_validation_command(self):
        artifact = self.write(self.builder.work / "bad.apk")
        self.builder.collect([artifact], "Android", time.time())
        output = io.StringIO()
        with patch.object(build.VERIFY, "verify") as verify, contextlib.redirect_stdout(output):
            self.builder.finish()
        self.assertEqual((self.args.output / "bad.apk").read_bytes(), artifact.read_bytes())
        verify.assert_not_called()
        self.assertIn("scripts/verify-release.py check", output.getvalue())
        self.assertIn("--version 3.8.4", output.getvalue())

    def test_add_platform_preserves_existing_packages_and_checksums(self):
        existing = self.write(self.args.output / "siyuan-3.8.4-win.exe", b"signed windows")
        artifact = self.write(self.builder.work / "siyuan-3.8.4.apk", b"android")
        self.write(self.args.output / "SHA256SUMS.txt", b"old sums")
        self.builder.collect([artifact], "Android", time.time())
        with patch.object(build.VERIFY, "verify", return_value=0), contextlib.redirect_stdout(io.StringIO()):
            self.builder.finish()
        self.assertEqual((self.args.output / "SHA256SUMS.txt").read_bytes(), b"old sums")
        self.assertTrue((self.args.output / "siyuan-3.8.4.apk").is_file())
        self.assertEqual(existing.read_bytes(), b"signed windows")

    def test_finish_does_not_generate_checksums(self):
        artifact = self.write(self.builder.work / "siyuan-3.8.4.apk", b"android")
        self.builder.collect([artifact], "Android", time.time())
        with patch.object(build.VERIFY, "verify", return_value=0), contextlib.redirect_stdout(io.StringIO()):
            self.builder.finish()
        self.assertEqual((self.args.output / artifact.name).read_bytes(), b"android")
        self.assertFalse((self.args.output / "SHA256SUMS.txt").exists())
        self.assertFalse((self.builder.work / "SHA256SUMS.txt").exists())

    def test_default_plan_does_not_run_commands(self):
        with patch.object(build.sys, "argv", ["build-release.py"]), patch.object(build, "run") as command, \
                patch.object(build, "create_record") as record, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(build.main(), 0)
        command.assert_not_called()
        record.assert_not_called()

    def test_collection_is_immediate_and_does_not_overwrite(self):
        artifact = self.write(self.builder.work / "test.apk", b"first")
        with patch.object(build.VERIFY, "verify") as verify:
            self.builder.collect([artifact], "Android", time.time())
            verify.assert_not_called()
        self.assertEqual((self.args.output / "test.apk").read_bytes(), b"first")
        artifact.write_bytes(b"second")
        with self.assertRaises(build.BuildError):
            self.builder.collect([artifact], "Android", time.time())
        self.assertEqual((self.args.output / "test.apk").read_bytes(), b"first")


class RecordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.args = build.parser().parse_args([])
        self.args.platforms = ["windows", "linux"]
        self.args.output = self.root / "output"
        self.args.android_dir = self.root / "android"
        self.args.harmony_dir = self.root / "harmony"
        self.args.records_dir = self.root / "records"
        self.directory = self.root / "run"
        self.directory.mkdir()
        self.record = build.BuildRecord(self.directory, self.args, "3.8.4")

    def progress(self):
        return json.loads((self.directory / "progress.json").read_text(encoding="utf-8"))

    def test_command_output_is_streamed_to_terminal_and_log(self):
        acknowledged = self.root / "acknowledged"
        script = self.root / "output.py"
        script.write_text(
            "import pathlib, sys, time\n"
            "print('实时输出', end='', flush=True)\n"
            f"ack = pathlib.Path({str(acknowledged)!r})\n"
            "deadline = time.monotonic() + 5\n"
            "while not ack.exists() and time.monotonic() < deadline:\n"
            "    time.sleep(0.01)\n"
            "if not ack.exists():\n"
            "    sys.exit(9)\n"
            "print('错误流输出', file=sys.stderr, flush=True)\n", encoding="utf-8")

        class Terminal(io.StringIO):
            def write(terminal, value):
                if "实时输出" in value:
                    acknowledged.touch()
                return super().write(value)

        terminal = Terminal()
        with contextlib.redirect_stdout(terminal), self.record.session(), self.record.stage("preflight"):
            build.run([sys.executable, "-X", "utf8", "-u", script], self.root)
        log = (self.directory / "build.log").read_text(encoding="utf-8")
        for value in ("实时输出", "错误流输出", "发布记录已保存"):
            self.assertIn(value, log)
            self.assertIn(value, terminal.getvalue())
        self.assertRegex(log, r"\[\d{4}-\d{2}-\d{2}T")
        self.assertEqual(self.progress()["last_command"]["returncode"], 0)
        self.assertIsNone(build.ACTIVE_RECORD)

    def test_failed_command_preserves_stage_and_later_pending_steps(self):
        script = self.root / "failure.py"
        script.write_text("import sys\nprint('build failed', file=sys.stderr)\nsys.exit(7)\n", encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(build.BuildError):
            with self.record.session(), self.record.stage("preflight"):
                build.run([sys.executable, script], self.root)
        progress = self.progress()
        self.assertEqual(progress["status"], "failed")
        self.assertEqual(progress["stages"][0]["status"], "failed")
        self.assertTrue(all(stage["status"] == "pending" for stage in progress["stages"][1:]))
        self.assertEqual(progress["last_command"]["returncode"], 7)
        self.assertIn("build failed", (self.directory / "build.log").read_text(encoding="utf-8"))
        self.assertIsNone(build.ACTIVE_RECORD)

    def test_interrupt_preserves_progress(self):
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(KeyboardInterrupt):
            with self.record.session(), self.record.stage("preflight"):
                raise KeyboardInterrupt()
        progress = self.progress()
        self.assertEqual(progress["status"], "interrupted")
        self.assertEqual(progress["stages"][0]["status"], "interrupted")
        self.assertIsNone(build.ACTIVE_RECORD)

    def test_ssh_authentication_keeps_terminal_handles(self):
        builder = build.Builder(self.args, "3.8.4", self.root, self.record)
        result = subprocess.CompletedProcess([], 0)
        with contextlib.redirect_stdout(io.StringIO()), self.record.session(), \
                patch.object(build.subprocess, "run", return_value=result) as run, \
                patch.object(build.subprocess, "Popen") as popen:
            builder.wsl(["git", "fetch", "origin", "refs/heads/dev"])
        self.assertIsNone(run.call_args.kwargs["stdout"])
        self.assertIsNone(run.call_args.kwargs["stderr"])
        self.assertNotIn("stdin", run.call_args.kwargs)
        self.assertTrue(self.progress()["last_command"]["interactive"])
        popen.assert_not_called()

    def test_capture_output_and_environment_are_not_dumped(self):
        result = subprocess.CompletedProcess([], 0, stdout="private capture", stderr="")
        with contextlib.redirect_stdout(io.StringIO()), self.record.session(), \
                patch.object(build.subprocess, "run", return_value=result):
            value = build.run(["git", "diff", "HEAD"], self.root, env={"TOKEN": "private environment"}, capture=True)
        self.assertEqual(value, "private capture")
        for filename in ("build.log", "progress.json"):
            content = (self.directory / filename).read_text(encoding="utf-8")
            self.assertNotIn("private capture", content)
            self.assertNotIn("private environment", content)

    def test_atomic_progress_write_preserves_previous_snapshot_on_failure(self):
        self.record.save()
        original = self.progress()
        self.record.data["status"] = "running"
        with patch.object(build.os, "replace", side_effect=OSError("write failed")), self.assertRaises(OSError):
            self.record.save()
        self.assertEqual(self.progress(), original)
        self.assertFalse((self.directory / "progress.json.tmp").exists())

    def test_record_directories_are_unique_and_outside_outputs(self):
        with patch.object(build.tempfile, "gettempdir", return_value=str(self.root / "system-temp")):
            first = build.create_record(self.args, "3.8.4")
            second = build.create_record(self.args, "3.8.4")
        self.assertNotEqual(first.directory, second.directory)
        self.assertEqual(first.directory.parent, self.args.records_dir / "3.8.4")
        self.assertFalse(self.args.output.exists())

    def test_record_directory_rejects_build_and_package_locations(self):
        for path in (build.ROOT / "records", self.args.android_dir / "records", self.args.harmony_dir / "records",
                     self.args.output, self.args.output / "records", Path(tempfile.gettempdir()) / "release-records"):
            self.args.records_dir = path
            with self.subTest(path=path), self.assertRaises(build.BuildError):
                build.create_record(self.args, "3.8.4")

    def test_execution_records_partial_windows_success(self):
        def windows_arch(builder, arch, config):
            if arch == "arm64":
                raise build.BuildError("ARM64 build failed")
            package = builder.work / "windows.exe"
            package.write_bytes(b"package")
            builder.collect([package], "Windows", time.time())

        with contextlib.redirect_stdout(io.StringIO()), patch.object(build.tempfile, "tempdir", str(self.root)), \
                patch.object(build.Builder, "preflight"), patch.object(build.Builder, "build_ui"), \
                patch.object(build.Builder, "windows_tools"), \
                patch.object(build.Builder, "windows_arch", windows_arch), \
                patch.object(build.Builder, "linux") as linux, self.assertRaises(build.BuildError):
            with self.record.session():
                build.execute_build(self.args, "3.8.4", self.record)
        stages = {stage["id"]: stage for stage in self.progress()["stages"]}
        self.assertEqual(stages["windows_amd64"]["status"], "succeeded")
        self.assertEqual(stages["windows_amd64"]["artifacts"], [str(self.args.output / "windows.exe")])
        self.assertEqual(stages["windows_arm64"]["status"], "failed")
        self.assertEqual(stages["linux"]["status"], "pending")
        self.assertNotIn("verification", stages)
        linux.assert_not_called()

    def test_complete_execution_persists_progress_without_validation(self):
        def windows_arch(builder, arch, config):
            package = builder.work / f"siyuan-3.8.4-win-{arch}.exe"
            package.write_bytes(b"package")
            builder.collect([package], "Windows", time.time())

        def linux(builder):
            package = builder.work / "siyuan-3.8.4-linux.AppImage"
            package.write_bytes(b"package")
            builder.collect([package], "Linux", time.time())

        with contextlib.redirect_stdout(io.StringIO()), patch.object(build.tempfile, "tempdir", str(self.root)), \
                patch.object(build.Builder, "preflight"), patch.object(build.Builder, "build_ui"), \
                patch.object(build.Builder, "windows_tools"), \
                patch.object(build.Builder, "windows_arch", windows_arch), patch.object(build.Builder, "linux", linux), \
                patch.object(build.VERIFY, "verify") as verify:
            with self.record.session():
                build.execute_build(self.args, "3.8.4", self.record)
        progress = self.progress()
        self.assertEqual(progress["status"], "succeeded")
        self.assertTrue(all(stage["status"] == "succeeded" for stage in progress["stages"]))
        verify.assert_not_called()
        self.assertFalse((self.directory / "verification.json").exists())
        self.assertNotIn("verification", [stage["id"] for stage in progress["stages"]])
        self.assertFalse((self.args.output / "build.log").exists())
        self.assertFalse((self.args.output / "progress.json").exists())

    def test_preflight_failure_is_saved_before_work_directory_creation(self):
        with contextlib.redirect_stdout(io.StringIO()), \
                patch.object(build.Builder, "preflight", side_effect=build.BuildError("missing tool")), \
                patch.object(build.Builder, "build_ui") as ui, self.assertRaises(build.BuildError):
            with self.record.session():
                build.execute_build(self.args, "3.8.4", self.record)
        self.assertEqual(self.progress()["status"], "failed")
        self.assertEqual(self.progress()["stages"][0]["error"], "missing tool")
        self.assertIsNone(self.progress()["work_directory"])
        self.assertFalse((self.directory / "verification.json").exists())
        ui.assert_not_called()

if __name__ == "__main__":
    unittest.main()

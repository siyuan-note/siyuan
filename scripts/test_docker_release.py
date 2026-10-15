"""Docker 发布验收、manifest 校验和缓存日志的回归测试，不构建镜像。"""

import copy
import contextlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


release = module("docker_release", "verify-docker-release.py")
cache = module("docker_cache", "check-docker-cache.py")
IMAGE = "b3log/siyuan@sha256:" + "a" * 64


def manifest():
    entries = []
    for index, platform in enumerate(release.PLATFORMS):
        parts = platform.split("/")
        target = {"os": parts[0], "architecture": parts[1]}
        if len(parts) == 3:
            target["variant"] = parts[2]
        elif parts[1] == "arm64":
            target["variant"] = "v8"
        entries.append({"platform": target, "digest": "sha256:" + str(index + 1) * 64})
    return {"manifests": entries}


def report():
    return {"image": IMAGE, "version": "3.8.7", "status": "passed", "platforms": [
        {"platform": platform, "digest": digest, "checks": sorted(release.CHECKS)}
        for platform, digest in release.manifests(manifest()).items()]}


class ManifestTests(unittest.TestCase):
    def test_keeps_arm32_variants_separate_and_normalizes_arm64(self):
        self.assertEqual(set(release.manifests(manifest())), set(release.PLATFORMS))

    def test_accepts_attestations_but_rejects_unknown_executable_platform(self):
        index = manifest()
        index["manifests"].append({"platform": {"os": "unknown", "architecture": "unknown"},
                                   "annotations": {"vnd.docker.reference.type": "attestation-manifest"}})
        self.assertEqual(len(release.manifests(index)), 4)
        index["manifests"][-1].pop("annotations")
        with self.assertRaises(ValueError):
            release.manifests(index)

    def test_missing_duplicate_and_invalid_digest_are_rejected(self):
        for change in (lambda value: value["manifests"].pop(),
                       lambda value: value["manifests"].append(copy.deepcopy(value["manifests"][0])),
                       lambda value: value["manifests"][0].update(digest="latest")):
            with self.subTest(change=change):
                index = manifest()
                change(index)
                with self.assertRaises(ValueError):
                    release.manifests(index)


class OCRTests(unittest.TestCase):
    def test_recognition_tolerates_layout_whitespace_and_latin_case(self):
        release.validate_rows('[{"text":"SiYuan"},{"text":" OCR123"}]', "siyuan ocr 123")
        release.validate_rows('[{"text":"思源"},{"text":"笔记"}]', "思源笔记")
        release.validate_rows("[]", None)

    def test_blank_false_positive_wrong_text_and_invalid_response_are_rejected(self):
        for output, expected in (("{}", None), ('[{"text":5}]', None), ('[{"text":"noise"}]', None),
                                 ('[{"text":"思源笔计"}]', "思源笔记")):
            with self.subTest(output=output), self.assertRaises(ValueError):
                release.validate_rows(output, expected)


class WorkerVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.fixtures = Path(self.temp.name)
        self.library_failure = False
        self.worker_failure = False
        self.recognitions = []

    def command(self, arguments, **kwargs):
        output, error, code = "", "", 0
        if "--entrypoint" in arguments:
            entrypoint = arguments[arguments.index("--entrypoint") + 1]
            if entrypoint == "/bin/sh":
                shell = arguments[-1]
                if "ldd /opt/siyuan/stage/ocr/runtime/linux-arm/siyuan-ocr" in shell:
                    raise RuntimeError("Not a valid dynamic program")
                if self.library_failure and "ldd /opt/siyuan/stage/ocr/runtime/linux-arm/libonnxruntime.so" in shell:
                    raise RuntimeError("libstdc++.so.6: not found")
            elif entrypoint == "/opt/siyuan/kernel":
                output = "SiYuan Kernel version 3.8.7"
            else:
                payload = json.loads(kwargs["input"])
                self.recognitions.append(payload["image"])
                if "missing-onnxruntime.so" in payload["config"]["library"]:
                    error, code = "missing-onnxruntime.so: not found", 1
                elif self.worker_failure:
                    raise RuntimeError("Worker could not load ONNX runtime")
                elif payload["image"].endswith("chinese.png"):
                    output = json.dumps([{"text": "思源笔记"}])
                elif payload["image"].endswith("latin.png"):
                    output = json.dumps([{"text": "SiYuan OCR 123"}])
                else:
                    output = "[]"
        return subprocess.CompletedProcess(arguments, code, output, error)

    def verify(self, platform):
        def notebook(image, target, version, timeout, fail_ocr, diagnostics):
            fail_ocr()

        with patch.object(release, "run", side_effect=self.command), \
                patch.object(release, "verify_notebook", side_effect=notebook) as verify_notebook:
            result = release.verify_platform("b3log/siyuan", IMAGE.partition("@")[2], platform,
                                             "3.8.7", self.fixtures, 240)
        self.assertEqual(verify_notebook.call_count, 1)
        return result

    def test_arm32_worker_is_verified_by_real_requests_without_ldd_precheck(self):
        for platform in ("linux/arm/v7", "linux/arm/v8"):
            with self.subTest(platform=platform):
                self.recognitions.clear()
                result = self.verify(platform)
                self.assertEqual(set(result["checks"]), release.CHECKS)
                self.assertEqual(self.recognitions, ["", "/fixtures/chinese.png", "/fixtures/latin.png",
                                                      "/fixtures/blank.png", ""])

    def test_failed_model_load_still_blocks_verification(self):
        self.worker_failure = True
        with patch.object(release, "verify_notebook") as notebook:
            with patch.object(release, "run", side_effect=self.command):
                with self.assertRaisesRegex(RuntimeError, "could not load ONNX"):
                    release.verify_platform("b3log/siyuan", IMAGE.partition("@")[2], "linux/arm/v7",
                                            "3.8.7", self.fixtures, 240)
            notebook.assert_not_called()
        self.assertEqual(self.recognitions, [""])

    def test_missing_shared_library_still_blocks_before_worker_execution(self):
        self.library_failure = True
        with patch.object(release, "run", side_effect=self.command):
            with self.assertRaisesRegex(RuntimeError, "libstdc"):
                release.verify_platform("b3log/siyuan", IMAGE.partition("@")[2], "linux/arm/v8",
                                        "3.8.7", self.fixtures, 240)
        self.assertEqual(self.recognitions, [])


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "report.json"

    def save(self, value):
        self.path.write_text(json.dumps(value), encoding="utf-8")

    def test_failed_partial_or_mismatched_verification_never_publishes(self):
        for mutate in (lambda value: value.update(status="failed"), lambda value: value["platforms"].pop(),
                       lambda value: value.update(image=IMAGE.replace("a", "b")),
                       lambda value: value.update(version="3.8.8"),
                       lambda value: value["platforms"][0]["checks"].remove("chinese")):
            value = report()
            mutate(value)
            self.save(value)
            with self.subTest(mutate=mutate), patch.object(release, "run") as run:
                with self.assertRaises(ValueError):
                    release.promote(IMAGE, "3.8.7", self.path)
                run.assert_not_called()

    def test_publishes_verified_digest_then_checks_both_tags(self):
        self.save(report())
        response = subprocess.CompletedProcess([], 0, json.dumps(manifest()), "")
        with patch.object(release, "run", return_value=response) as run:
            release.promote(IMAGE, "3.8.7", self.path)
        command = run.call_args_list[1].args[0]
        self.assertEqual(command[-1], IMAGE)
        self.assertIn("b3log/siyuan:v3.8.7", command)
        self.assertIn("b3log/siyuan:latest", command)
        self.assertEqual(run.call_count, 4)

    def test_remote_manifest_difference_is_reported(self):
        self.save(report())
        changed = manifest()
        changed["manifests"][0]["digest"] = "sha256:" + "f" * 64
        responses = [subprocess.CompletedProcess([], 0, json.dumps(manifest()), ""),
                     subprocess.CompletedProcess([], 0, "", ""),
                     subprocess.CompletedProcess([], 0, json.dumps(changed), "")]
        with patch.object(release, "run", side_effect=responses):
            with self.assertRaisesRegex(ValueError, "differs"):
                release.promote(IMAGE, "3.8.7", self.path)

    def test_candidate_mismatch_blocks_all_release_tag_writes(self):
        self.save(report())
        changed = manifest()
        changed["manifests"][0]["digest"] = "sha256:" + "f" * 64
        with patch.object(release, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(changed), "")) as run:
            with self.assertRaisesRegex(ValueError, "differs"):
                release.promote(IMAGE, "3.8.7", self.path)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][3], "inspect")

    def test_smoke_failure_preserves_failed_report_and_blocks_promotion(self):
        fixtures = Path(self.temp.name) / "fixtures"
        fixtures.mkdir()
        for name in ("chinese", "latin", "blank"):
            (fixtures / (name + ".png")).write_bytes(b"fixture")
        with patch.object(release, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(manifest()), "")), \
                patch.object(release, "verify_platform", side_effect=RuntimeError("OCR failed")):
            with self.assertRaisesRegex(RuntimeError, "OCR failed"):
                release.verify(IMAGE, "3.8.7", fixtures, self.path, 240)
        self.assertEqual(json.loads(self.path.read_text())["status"], "failed")
        with patch.object(release, "run") as run:
            with self.assertRaises(ValueError):
                release.promote(IMAGE, "3.8.7", self.path)
            run.assert_not_called()

    def test_notebook_failure_removes_only_owned_test_resources(self):
        def run(command, **kwargs):
            if command[:2] == ["docker", "inspect"]:
                return subprocess.CompletedProcess([], 0, json.dumps([{"NetworkSettings": {"Ports": {
                    "6806/tcp": [{"HostPort": "12345"}]}}}]), "")
            return subprocess.CompletedProcess([], 0, "", "")
        with patch.object(release, "run", side_effect=run) as commands, \
                patch.object(release, "request", side_effect=[{"progress": 100}, "3.8.7"]):
            with self.assertRaisesRegex(RuntimeError, "worker failed"):
                release.verify_notebook(IMAGE, "linux/amd64", "3.8.7", 240,
                                        lambda: (_ for _ in ()).throw(RuntimeError("worker failed")))
        cleanup = [entry.args[0] for entry in commands.call_args_list if entry.args[0][:2] == ["docker", "rm"]]
        self.assertEqual(len(cleanup), 1)
        self.assertTrue(cleanup[0][-1].startswith("siyuan-docker-smoke-"))
        self.assertEqual(commands.call_args_list[-1].args[0][-1], cleanup[0][-1] + "-workspace")


class NotebookStartupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.diagnostics = Path(self.temp.name) / "diagnostics"
        self.running = "true"

    def command(self, arguments, **kwargs):
        output = ""
        if arguments[:2] == ["docker", "logs"]:
            output = "kernel startup log\n"
        elif arguments[:2] == ["docker", "inspect"]:
            if "{{.State.Running}}" in arguments:
                output = self.running
            elif "{{json .State}}" in arguments:
                output = json.dumps({"Running": self.running == "true", "ExitCode": 1})
            else:
                output = json.dumps([{"NetworkSettings": {"Ports": {"6806/tcp": [{"HostPort": "12345"}]}}}])
        return subprocess.CompletedProcess(arguments, 0, output, "")

    def test_startup_reset_and_early_disconnect_are_retried_until_ready(self):
        responses = [ConnectionResetError("reset before ready"), http.client.RemoteDisconnected("not ready"),
                     {"progress": 40}, {"progress": 100}, "3.8.7", {"notebook": {"id": "box"}},
                     "block", {"kramdown": "Docker OCR smoke 123"}]
        fail_ocr = Mock()
        with patch.object(release, "run", side_effect=self.command), \
                patch.object(release, "request", side_effect=responses) as request, patch.object(release.time, "sleep") as sleep:
            release.verify_notebook(IMAGE, "linux/amd64", "3.8.7", 240, fail_ocr, self.diagnostics)
        self.assertEqual(sleep.call_count, 3)
        fail_ocr.assert_called_once()
        endpoints = [call.args[1] for call in request.call_args_list]
        self.assertEqual(endpoints[:4], ["/api/system/bootProgress"] * 4)
        self.assertEqual(endpoints.count("/api/notebook/createNotebook"), 1)
        self.assertFalse(self.diagnostics.exists())

    def test_persistent_reset_times_out_with_diagnostics_and_never_writes_notebook(self):
        fail_ocr = Mock()
        with patch.object(release, "run", side_effect=self.command) as run, \
                patch.object(release, "request", side_effect=ConnectionResetError("still resetting")) as request, \
                patch.object(release.time, "monotonic", side_effect=[0, 0, 11]), \
                patch.object(release.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(TimeoutError, "still resetting"):
                release.verify_notebook(IMAGE, "linux/amd64", "3.8.7", 10, fail_ocr, self.diagnostics)
        fail_ocr.assert_not_called()
        self.assertTrue(all(call.args[1] == "/api/system/bootProgress" for call in request.call_args_list))
        self.assertEqual(self.diagnostics.joinpath("kernel.log").read_text(encoding="utf-8"), "kernel startup log\n")
        self.assertTrue(self.diagnostics.joinpath("kernel-state.json").is_file())
        self.assertEqual(run.call_args_list[-1].args[0][:3], ["docker", "volume", "rm"])

    def test_exited_kernel_fails_immediately_and_keeps_exit_state(self):
        self.running = "false"
        with patch.object(release, "run", side_effect=self.command), \
                patch.object(release, "request", side_effect=ConnectionResetError("reset")), \
                patch.object(release.time, "sleep") as sleep, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, "stopped before booting"):
                release.verify_notebook(IMAGE, "linux/amd64", "3.8.7", 240, Mock(), self.diagnostics)
        sleep.assert_not_called()
        self.assertFalse(json.loads(self.diagnostics.joinpath("kernel-state.json").read_text())["Running"])

    def test_connection_failure_after_ready_does_not_retry_notebook_mutations(self):
        responses = [{"progress": 100}, "3.8.7", ConnectionResetError("write failed")]
        with patch.object(release, "run", side_effect=self.command), \
                patch.object(release, "request", side_effect=responses) as request, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ConnectionResetError, "write failed"):
                release.verify_notebook(IMAGE, "linux/amd64", "3.8.7", 240, Mock(), self.diagnostics)
        self.assertEqual([call.args[1] for call in request.call_args_list].count("/api/notebook/createNotebook"), 1)

    def test_diagnostic_collection_failure_preserves_original_verification_error(self):
        def command(arguments, **kwargs):
            if arguments[:2] == ["docker", "logs"] or "{{json .State}}" in arguments:
                raise OSError("diagnostic unavailable")
            return self.command(arguments, **kwargs)
        with patch.object(release, "run", side_effect=command), \
                patch.object(release, "request", side_effect=[{"progress": 100}, "wrong version"]), \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "version differs"):
                release.verify_notebook(IMAGE, "linux/amd64", "3.8.7", 240, Mock(), self.diagnostics)


class PlatformReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.reports = self.root / "reports"
        self.reports.mkdir()
        self.output = self.root / "assembled.json"
        self.provenance = {"source_commit": "b" * 40, "configuration_commit": "c" * 40, "run_id": "123"}
        self.sources = {}
        self.paths = []
        for index, entry in enumerate(report()["platforms"]):
            image = "b3log/siyuan@sha256:" + str(index + 5) * 64
            value = {**report(), **self.provenance, "image": image, "platforms": [entry]}
            directory = self.reports / str(index)
            directory.mkdir()
            path = directory / "report.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            self.paths.append(path)
            self.sources[image] = {"manifests": [manifest()["manifests"][index]]}

    def command(self, arguments, **kwargs):
        if arguments[3] == "create":
            return subprocess.CompletedProcess(arguments, 0, "", "")
        if "--format" in arguments:
            value = {"digest": IMAGE.partition("@")[2]}
        else:
            value = self.sources.get(arguments[4], manifest())
        return subprocess.CompletedProcess(arguments, 0, json.dumps(value), "")

    def assemble(self):
        release.assemble("b3log/siyuan", "build-123-2-verified", "3.8.7", self.reports, self.output, self.provenance)

    def test_only_four_verified_current_run_candidates_are_assembled(self):
        with patch.object(release, "run", side_effect=self.command) as run:
            self.assemble()
        commands = [call.args[0] for call in run.call_args_list if call.args[0][3] == "create"]
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][5], "b3log/siyuan:build-123-2-verified")
        self.assertEqual(set(commands[0][6:]), set(self.sources))
        value = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(value["status"], "passed")
        self.assertEqual(value["image"], IMAGE)
        self.assertEqual(release.verified_platforms(value, IMAGE, "3.8.7"), release.manifests(manifest()))
        self.assertEqual(value["run_id"], "123")

    def test_old_source_configuration_run_failed_or_incomplete_reports_block_assembly(self):
        original = json.loads(self.paths[0].read_text(encoding="utf-8"))
        changes = [lambda value: value.update(source_commit="d" * 40),
                   lambda value: value.update(configuration_commit="d" * 40),
                   lambda value: value.update(run_id="122"), lambda value: value.update(status="failed"),
                   lambda value: value.update(version="3.8.8"),
                   lambda value: value["platforms"][0]["checks"].remove("chinese"),
                   lambda value: value["platforms"][0].update(platform="linux/arm64"),
                   lambda value: value.update(image=value["image"].replace("b3log/siyuan", "other/repo"))]
        for change in changes:
            value = copy.deepcopy(original)
            change(value)
            self.paths[0].write_text(json.dumps(value), encoding="utf-8")
            with self.subTest(change=change), patch.object(release, "run", side_effect=self.command) as run:
                with self.assertRaises(ValueError):
                    self.assemble()
                self.assertFalse(any(call.args[0][3] == "create" for call in run.call_args_list))
                self.assertFalse(self.output.exists())

    def test_missing_platform_report_blocks_assembly(self):
        self.paths[-1].unlink()
        with patch.object(release, "run") as run:
            with self.assertRaisesRegex(ValueError, "four"):
                self.assemble()
            run.assert_not_called()

    def test_report_digest_must_match_its_platform_candidate(self):
        source = next(iter(self.sources.values()))
        source["manifests"][0]["digest"] = "sha256:" + "f" * 64
        with patch.object(release, "run", side_effect=self.command) as run:
            with self.assertRaisesRegex(ValueError, "digest differs"):
                self.assemble()
        self.assertFalse(any(call.args[0][3] == "create" for call in run.call_args_list))

    def test_assembled_digest_mismatch_never_creates_successful_report(self):
        def mismatched(arguments, **kwargs):
            response = self.command(arguments, **kwargs)
            if arguments[3] == "inspect" and arguments[4] == IMAGE:
                value = manifest()
                value["manifests"].pop()
                response.stdout = json.dumps(value)
            return response
        with patch.object(release, "run", side_effect=mismatched) as run:
            with self.assertRaises(ValueError):
                self.assemble()
        self.assertFalse(self.output.exists())
        for call in run.call_args_list:
            self.assertNotIn("b3log/siyuan:latest", call.args[0])
            self.assertNotIn("b3log/siyuan:v3.8.7", call.args[0])

    def test_single_platform_verification_keeps_every_smoke_check_and_provenance(self):
        fixtures = self.root / "fixtures"
        fixtures.mkdir()
        for name in ("chinese", "latin", "blank"):
            (fixtures / (name + ".png")).write_bytes(b"fixture")
        entry = report()["platforms"][3]
        response = subprocess.CompletedProcess([], 0, json.dumps({"manifests": [manifest()["manifests"][3]]}), "")
        with patch.object(release, "run", return_value=response), \
                patch.object(release, "verify_platform", return_value=entry) as verify:
            release.verify(IMAGE, "3.8.7", fixtures, self.output, 240,
                           platform="linux/arm/v8", provenance=self.provenance)
        self.assertEqual(verify.call_count, 1)
        self.assertEqual(verify.call_args.args[2], "linux/arm/v8")
        value = json.loads(self.output.read_text(encoding="utf-8"))
        self.assertEqual(value["source_commit"], self.provenance["source_commit"])
        self.assertEqual(set(value["platforms"][0]["checks"]), release.CHECKS)

    def test_wrong_or_extra_platform_in_single_candidate_is_rejected(self):
        for value in (manifest(), {"manifests": [manifest()["manifests"][0]]}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                release.manifests(value, ("linux/arm/v8",))


class CacheTests(unittest.TestCase):
    def test_resource_measurements_use_binary_units_and_deduplicate_cache_layers(self):
        self.assertEqual(cache.memory_bytes("1.5GiB"), 1610612736)
        self.assertEqual(cache.memory_bytes("512MiB"), 536870912)
        self.assertEqual(cache.cache_bytes({"layers": [{"digest": "one", "size": 100}, {"digest": "one", "size": 100}],
                                           "config": {"digest": "two", "size": 12}}), 112)
        self.assertIsNone(cache.cache_bytes({"manifests": []}))

    def log(self, cached):
        return "\n".join(f"#{index} [{platform} onnx-build 5/5] RUN python3 /onnxruntime/tools/ci_build/build.py --build\n"
                         f"#{index} {'CACHED' if cached else 'DONE 12.3s'}"
                         for index, platform in enumerate(release.PLATFORMS))

    def test_distinguishes_real_compilation_from_cached_steps(self):
        self.assertTrue(all(cache.onnx_steps(self.log(True)).values()))
        self.assertFalse(any(cache.onnx_steps(self.log(False)).values()))

    def test_missing_architecture_or_only_dependency_cache_is_not_accepted(self):
        for log in (self.log(True).replace("linux/arm/v8", "linux/arm/v7"),
                    self.log(True).replace("RUN python3 /onnxruntime/tools/ci_build/build.py", "RUN apk add cmake")):
            with self.assertRaises(ValueError):
                cache.onnx_steps(log)

    def test_per_platform_cache_acceptance_does_not_accept_other_arm_variants(self):
        line = "#1 [linux/arm/v8 onnx-build 5/5] RUN python3 /onnxruntime/tools/ci_build/build.py --build\n#1 CACHED"
        self.assertEqual(cache.onnx_steps(line, {"linux/arm/v8"}), {"linux/arm/v8": True})
        with self.assertRaises(ValueError):
            cache.onnx_steps(line, {"linux/arm64"})

    def test_selected_platform_is_used_for_all_four_cache_acceptance_cases(self):
        def build(context, cache_ref, directory, name, *, platforms, **kwargs):
            self.assertEqual(platforms, {"linux/arm64"})
            return {"cached": {"linux/arm64": name in ("warm", "application-change")}}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dockerfile = root / "Dockerfile"
            dockerfile.write_text("FROM alpine AS onnx-build\n", encoding="utf-8")
            with patch("sys.argv", ["check-docker-cache.py", "--dockerfile", str(dockerfile),
                                    "--cache-repository", "b3log/siyuan", "--records", str(root / "records"),
                                    "--platform", "linux/arm64"]), patch.object(cache, "build_case", side_effect=build) as run:
                cache.main()
            self.assertEqual(run.call_count, 4)
            value = json.loads(root.joinpath("records/report.json").read_text(encoding="utf-8"))
            self.assertEqual(value["status"], "passed")
            self.assertEqual(value["platforms"], ["linux/arm64"])


class SourceDownloadTests(unittest.TestCase):
    def execute(self, fetch_failures=0, submodule_failures=0, actual_commit=None):
        shell = shutil.which("sh")
        if shell is None:
            git = shutil.which("git")
            candidate = Path(git).parents[1] / "bin/sh.exe" if git else None
            shell = str(candidate) if candidate and candidate.is_file() else None
        if shell is None:
            self.skipTest("A POSIX shell is required for Docker source download tests")
        dockerfile = Path(__file__).resolve().parents[1].joinpath("Dockerfile").read_text(encoding="utf-8")
        stage = dockerfile.split("AS onnx-source\n", 1)[1].split("\nFROM ", 1)[0]
        script = stage.split("RUN <<EORUN\n", 1)[1].split("\nEORUN", 1)[0]
        commit = stage.split("ARG ONNX_COMMIT=", 1)[1].splitlines()[0]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trace = root / "trace"
            harness = r'''fetch_calls=0
submodule_calls=0
git() {
    printf '%s\n' "$*" >> "$TRACE"
    case "$1" in
        init) mkdir -p "$2" ;;
        fetch)
            fetch_calls=$((fetch_calls + 1))
            if [ "$fetch_calls" -le "$FETCH_FAILURES" ]; then return 1; fi ;;
        rev-parse) printf '%s\n' "$ACTUAL_COMMIT" ;;
        -c)
            submodule_calls=$((submodule_calls + 1))
            if [ "$submodule_calls" -le "$SUBMODULE_FAILURES" ]; then return 1; fi ;;
    esac
    return 0
}
sleep() { printf 'sleep %s\n' "$*" >> "$TRACE"; }
'''
            path = root / "download.sh"
            source = root.joinpath("source").as_posix()
            script = script.replace("git init /onnxruntime", 'git init "' + source + '"')
            script = script.replace("cd /onnxruntime", 'cd "' + source + '"')
            path.write_text(harness + script,
                            encoding="utf-8", newline="\n")
            env = dict(os.environ, TRACE=trace.as_posix(), FETCH_FAILURES=str(fetch_failures),
                       SUBMODULE_FAILURES=str(submodule_failures), ONNX_COMMIT=commit,
                       ACTUAL_COMMIT=actual_commit or commit)
            result = subprocess.run([shell, "-e", str(path)], env=env, capture_output=True, text=True, timeout=20)
            return result.returncode, trace.read_text(encoding="utf-8").splitlines(), commit

    def test_network_failure_retries_only_the_locked_shallow_fetch(self):
        code, trace, commit = self.execute(fetch_failures=2)
        self.assertEqual(code, 0)
        self.assertEqual(sum(line.startswith("init ") for line in trace), 1)
        self.assertEqual(trace.count("fetch --depth=1 --no-tags origin " + commit), 3)
        self.assertEqual([line for line in trace if line.startswith("sleep ")], ["sleep 10", "sleep 20"])
        self.assertIn("checkout --detach FETCH_HEAD", trace)
        self.assertIn("remote add origin https://github.com/microsoft/onnxruntime", trace)

    def test_exhausted_fetch_or_wrong_commit_stops_before_submodules(self):
        for options in ({"fetch_failures": 3}, {"actual_commit": "0" * 40}):
            with self.subTest(options=options):
                code, trace, _ = self.execute(**options)
                self.assertNotEqual(code, 0)
                self.assertFalse(any("submodule update" in line for line in trace))

    def test_submodule_retry_preserves_the_downloaded_superproject(self):
        code, trace, _ = self.execute(submodule_failures=2)
        self.assertEqual(code, 0)
        self.assertEqual(sum(line.startswith("fetch ") for line in trace), 1)
        self.assertEqual(trace.count("-c http.version=HTTP/1.1 submodule update --init --recursive --depth=1"), 3)


if __name__ == "__main__":
    unittest.main()

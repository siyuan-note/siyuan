"""Docker 发布验收、manifest 校验和缓存日志的回归测试，不构建镜像。"""

import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


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
        command = run.call_args_list[0].args[0]
        self.assertEqual(command[-1], IMAGE)
        self.assertIn("b3log/siyuan:v3.8.7", command)
        self.assertIn("b3log/siyuan:latest", command)
        self.assertEqual(run.call_count, 3)

    def test_remote_manifest_difference_is_reported(self):
        self.save(report())
        changed = manifest()
        changed["manifests"][0]["digest"] = "sha256:" + "f" * 64
        with patch.object(release, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(changed), "")):
            with self.assertRaisesRegex(ValueError, "differs"):
                release.promote(IMAGE, "3.8.7", self.path)

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

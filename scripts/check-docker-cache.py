"""用独立缓存和全新 builder 验收 ONNX 的冷构建、热构建及失效行为。"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid


PLATFORMS = {"linux/amd64", "linux/arm64", "linux/arm/v7", "linux/arm/v8"}


def memory_bytes(value):
    match = re.match(r"([0-9.]+)\s*(B|KiB|MiB|GiB|TiB)\b", value)
    if not match:
        raise ValueError(f"Unknown Docker memory measurement: {value}")
    return int(float(match[1]) * 1024 ** ("B", "KiB", "MiB", "GiB", "TiB").index(match[2]))


def cache_bytes(manifest):
    # 当前 registry 导出使用 OCI image manifest，统计其引用的压缩层和配置大小。
    if "layers" not in manifest:
        return None
    entries = [*manifest["layers"], manifest.get("config", {})]
    sizes = {entry["digest"]: entry["size"] for entry in entries if "digest" in entry and "size" in entry}
    return sum(sizes.values())


def onnx_steps(log, expected=PLATFORMS):
    steps, result = {}, {}
    for line in log.splitlines():
        match = re.match(r"^#(\d+) \[(?:(linux/[a-z0-9/]+) )?onnx-build \d+/\d+\] RUN "
                         r"(?:python3 /onnxruntime/tools/ci_build/build.py|/bin/sh /docker-onnx-build.sh)", line)
        if match:
            if match[2] is None and len(expected) != 1:
                raise ValueError("ONNX log has no unambiguous target platform")
            steps[match[1]] = match[2] or next(iter(expected))
        status = re.match(r"^#(\d+) (CACHED|DONE)(?:\s|$)", line)
        if status and status[1] in steps:
            platform = steps[status[1]]
            result[platform] = result.get(platform, False) or status[2] == "CACHED"
    if set(result) != set(expected):
        raise ValueError(f"Incomplete ONNX build log: {tuple(result)}")
    return result


def build_case(context, cache, directory, name, *, import_cache, revision=None, platforms=PLATFORMS, onnx_parallel=2):
    builder = "siyuan-cache-check-" + uuid.uuid4().hex
    started = time.monotonic()
    log_path = directory / (name + ".log")
    stopped = threading.Event()
    measurements = {"peak_builder_memory_bytes": None, "minimum_host_free_disk_bytes": shutil.disk_usage(directory).free}

    def sample():
        last_progress = started
        while not stopped.is_set():
            measurements["minimum_host_free_disk_bytes"] = min(
                measurements["minimum_host_free_disk_bytes"], shutil.disk_usage(directory).free)
            try:
                stats = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}",
                                        "buildx_buildkit_" + builder + "0"], capture_output=True, text=True, timeout=5)
                if stats.returncode == 0 and stats.stdout.strip():
                    used = memory_bytes(json.loads(stats.stdout)["MemUsage"].split("/")[0].strip())
                    measurements["peak_builder_memory_bytes"] = max(measurements["peak_builder_memory_bytes"] or 0, used)
            except (subprocess.TimeoutExpired, ValueError, KeyError):
                pass
            now = time.monotonic()
            if now - last_progress >= 60:
                print(f"{name}: {int(now - started)}s elapsed, measurements={measurements}", flush=True)
                last_progress = now
            stopped.wait(5)

    monitor = threading.Thread(target=sample, daemon=True)
    try:
        subprocess.run(["docker", "buildx", "create", "--name", builder, "--driver", "docker-container"], check=True)
        monitor.start()
        command = ["docker", "buildx", "build", "--builder", builder, "--target", "onnx-build",
                   "--platform", ",".join(sorted(platforms)), "--progress", "plain", "--output", "type=cacheonly",
                   "--build-arg", "ONNX_BUILD_PARALLEL=" + str(onnx_parallel),
                   "--cache-to", "type=registry,ref=" + cache + ",mode=max"]
        if import_cache:
            command += ["--cache-from", "type=registry,ref=" + cache]
        if revision is not None:
            command += ["--build-arg", "ONNX_TOOLCHAIN_REV=" + revision]
        command.append(str(context))
        # 将完整日志留在验收目录，终端只显示当前轮次和最后的缓存命中结果。
        with log_path.open("w", encoding="utf-8") as log:
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True)
        hits = onnx_steps(log_path.read_text(encoding="utf-8"), platforms)
        exported = subprocess.run(["docker", "buildx", "imagetools", "inspect", cache, "--raw"],
                                  capture_output=True, text=True, check=True)
        return {"case": name, "cached": hits, "seconds": round(time.monotonic() - started, 3),
                "cache_referenced_bytes": cache_bytes(json.loads(exported.stdout)), **measurements}
    finally:
        stopped.set()
        if monitor.is_alive():
            monitor.join(timeout=10)
        subprocess.run(["docker", "buildx", "rm", "--force", builder], check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dockerfile", type=Path, required=True)
    parser.add_argument("--cache-repository", required=True)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--platform", choices=sorted(PLATFORMS))
    parser.add_argument("--onnx-parallel", type=int, default=2)
    args = parser.parse_args()
    if args.onnx_parallel < 1:
        parser.error("ONNX parallelism must be a positive integer")
    if not re.fullmatch(r"[a-z0-9][a-z0-9./_-]*", args.cache_repository):
        parser.error("Expected a registry repository without a tag or digest")
    args.records.mkdir(parents=True, exist_ok=False)
    platforms = {args.platform} if args.platform else PLATFORMS
    cache = args.cache_repository + ":buildcache-check-" + uuid.uuid4().hex
    report = {"cache": cache, "platforms": sorted(platforms), "onnx_parallel": args.onnx_parallel,
              "status": "running", "cases": [],
              "dockerfile_sha256": hashlib.sha256(args.dockerfile.read_bytes()).hexdigest()}
    try:
        with tempfile.TemporaryDirectory(prefix="siyuan-onnx-cache-") as directory:
            context = Path(directory)
            (context / "Dockerfile").write_bytes(args.dockerfile.read_bytes())
            (context / "scripts").mkdir()
            for name in ("docker-onnx-build.sh", "docker-onnx-toolchain.cmake"):
                (context / "scripts" / name).write_bytes((args.dockerfile.parent / "scripts" / name).read_bytes())
            (context / "app").mkdir()
            for name, imported, changed in (("cold", False, False), ("warm", True, False),
                                             ("application-change", True, True), ("onnx-input-change", True, False)):
                print(f"ONNX cache acceptance: {name}", flush=True)
                if changed:
                    (context / "app/cache-probe.txt").write_text("changed application source\n", encoding="utf-8")
                revision = uuid.uuid4().hex if name == "onnx-input-change" else None
                result = build_case(context, cache, args.records, name, import_cache=imported, revision=revision,
                                    platforms=platforms, onnx_parallel=args.onnx_parallel)
                report["cases"].append(result)
                expected = name in ("warm", "application-change")
                if any(cached != expected for cached in result["cached"].values()):
                    raise ValueError(f"Unexpected cache reuse for {name}: {result['cached']}")
                print(json.dumps(result), flush=True)
        report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", error=str(error))
        raise
    finally:
        (args.records / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

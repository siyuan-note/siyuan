"""按独立构建输入复用 ONNX 运行库，向发布构建输出不可变的镜像摘要。"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time


ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = {"linux/amd64": "amd64", "linux/arm64": "arm64", "linux/arm/v7": "armv7", "linux/arm/v8": "armv8"}
FILES = ("scripts/docker-onnx-build.sh", "scripts/docker-onnx-toolchain.cmake")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


def inputs(context, platform):
    if platform not in PLATFORMS:
        raise ValueError("Unsupported ONNX platform")
    dockerfile = (context / "Dockerfile").read_text(encoding="utf-8")
    arguments = {}
    for name in ("ALPINE_IMAGE", "ONNX_VERSION"):
        matches = re.findall(r"^ARG " + name + r"=(.+)$", dockerfile, re.M)
        if len(matches) != 1:
            raise ValueError("Expected one default for " + name)
        arguments[name] = matches[0]
    # 应用源码、版本和 Go 工具链不属于 ONNX 的输入，不使独立产物失效。
    start = "FROM --platform=$BUILDPLATFORM ${ALPINE_IMAGE} AS onnx-source\n"
    end = "FROM ${ONNX_IMAGE} AS onnx-runtime\n"
    if dockerfile.count(start) != 1 or dockerfile.count(end) != 1:
        raise ValueError("Cannot identify ONNX build stages")
    stages = dockerfile.split(start, 1)[1].split(end, 1)[0]
    sources = {name: (context / name).read_text(encoding="utf-8") for name in FILES}
    payload = {"schema": 1, "platform": platform, "arguments": arguments, "stages": stages, "files": sources}
    key = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")).hexdigest()
    return key, arguments["ONNX_VERSION"]


def run(arguments, *, check=True, timeout=300):
    result = subprocess.run(arguments, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"Command failed: {arguments[0]}\n{result.stderr}")
    return result


def resolve(reference):
    result = run(["docker", "buildx", "imagetools", "inspect", reference, "--format", "{{json .Manifest}}"], check=False)
    if result.returncode:
        # 只有明确不存在的标签才触发构建；认证和网络故障必须直接报错。
        denied = re.search(r"unauthorized|denied|forbidden|authentication|authorization|insufficient_scope", result.stderr, re.I)
        missing = re.search(r"manifest unknown|" + re.escape(reference) + r": not found(?:\s|$)", result.stderr, re.I)
        if missing and not denied:
            return None
        raise RuntimeError("Cannot resolve ONNX artifact:\n" + result.stderr)
    descriptor = json.loads(result.stdout)
    digest = descriptor.get("digest") if isinstance(descriptor, dict) else None
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise ValueError("Invalid ONNX artifact digest")
    return reference.rsplit(":", 1)[0] + "@" + digest


def validate(image, platform, key, version):
    if not DIGEST.fullmatch(image.partition("@")[2]):
        raise ValueError("ONNX artifact must use an immutable digest")
    run(["docker", "pull", "--platform", platform, image], timeout=900)
    metadata = json.loads(run(["docker", "image", "inspect", image]).stdout)
    if len(metadata) != 1:
        raise ValueError("Ambiguous ONNX image metadata")
    value = metadata[0]
    labels = value.get("Config", {}).get("Labels") or {}
    expected = {"org.siyuan.onnx.inputs": key, "org.siyuan.onnx.platform": platform, "org.siyuan.onnx.version": version}
    if any(labels.get(name) != text for name, text in expected.items()):
        raise ValueError("ONNX artifact inputs, platform or version do not match")
    if value.get("Os") != "linux" or value.get("Architecture") != platform.split("/")[1]:
        raise ValueError("ONNX artifact architecture does not match")
    run(["docker", "run", "--rm", "--platform", platform, "--entrypoint", "/bin/sh", image, "-ec",
         "test -s /onnx-artifacts/LICENSE && test -s /onnx-artifacts/ThirdPartyNotices.txt "
         "&& test -s /onnx-artifacts/onnx-toolchain.txt && ldd /onnx-artifacts/libonnxruntime.so"])


def build(command, log_path):
    # 同时保留完整记录和实时输出，便于观察首次冷编译进度。
    with log_path.open("w", encoding="utf-8") as log:
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, encoding="utf-8", errors="replace") as process:
            for line in process.stdout:
                log.write(line)
                log.flush()
                print(line, end="", flush=True)
            code = process.wait()
            if code:
                raise subprocess.CalledProcessError(code, command)


def ensure(context, repository, platform, parallel, records):
    if not re.fullmatch(r"[a-z0-9][a-z0-9./_-]*", repository) or parallel < 1:
        raise ValueError("Invalid ONNX repository or parallelism")
    key, version = inputs(context, platform)
    tag = repository + ":onnx-" + PLATFORMS[platform] + "-" + key
    image = resolve(tag)
    reused = image is not None
    if not reused:
        cache = repository + ":buildcache-onnx-v3-" + PLATFORMS[platform]
        command = ["docker", "buildx", "build", "--target", "onnx-artifact", "--platform", platform,
                   "--provenance=false", "--push", "--progress", "plain", "--tag", tag,
                   "--build-arg", "ONNX_INPUT_KEY=" + key, "--build-arg", "ONNX_BUILD_PARALLEL=" + str(parallel),
                   "--cache-from", "type=registry,ref=" + cache, "--cache-to", "type=registry,ref=" + cache + ",mode=max",
                   str(context)]
        print("Building ONNX artifact: " + tag, flush=True)
        build(command, records / "build.log")
        image = resolve(tag)
        if image is None:
            raise RuntimeError("Built ONNX artifact is missing")
    validate(image, platform, key, version)
    return {"image": image, "inputs": key, "version": version, "platform": platform, "reused": reused}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", type=Path, default=ROOT)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--platform", choices=PLATFORMS, required=True)
    parser.add_argument("--parallel", type=int, default=2)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    args.records.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    report = {"status": "failed"}
    try:
        report.update(ensure(args.context.resolve(), args.repository, args.platform, args.parallel, args.records))
        report["status"] = "passed"
        if args.github_output:
            with args.github_output.open("a", encoding="utf-8") as stream:
                stream.write("onnx_image=" + report["image"] + "\n")
        print(json.dumps(report), flush=True)
    finally:
        report["seconds"] = round(time.monotonic() - started, 3)
        (args.records / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

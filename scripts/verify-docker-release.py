"""逐架构验证临时 Docker 镜像，并在验收通过后按 digest 发布。"""

import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
import uuid


PLATFORMS = ("linux/amd64", "linux/arm64", "linux/arm/v7", "linux/arm/v8")
CHECKS = {"licenses", "version", "model-load", "chinese", "latin", "blank", "worker-failure", "notebook"}
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")


def run(arguments, *, input=None, timeout=300, check=True):
    result = subprocess.run(arguments, input=input, text=True, encoding="utf-8", errors="replace",
                            capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {arguments[0]}\n{result.stderr}")
    return result


def platform_name(platform):
    name = platform.get("os", "") + "/" + platform.get("architecture", "")
    variant = platform.get("variant", "")
    if variant and not (name == "linux/arm64" and variant == "v8"):
        name += "/" + variant
    return name


def manifests(index, expected=PLATFORMS):
    result = {}
    for entry in index.get("manifests", []):
        if entry.get("annotations", {}).get("vnd.docker.reference.type") == "attestation-manifest":
            continue
        name = platform_name(entry.get("platform", {}))
        digest = entry.get("digest", "")
        if name in result or not DIGEST.fullmatch(digest):
            raise ValueError(f"Invalid or duplicate image manifest: {name}")
        result[name] = digest
    if set(result) != set(expected):
        raise ValueError(f"Expected {expected}, found {tuple(result)}")
    return result


def normalized(text):
    return "".join(unicodedata.normalize("NFKC", text).split()).casefold()


def validate_rows(output, expected):
    rows = json.loads(output)
    if not isinstance(rows, list) or any(not isinstance(row, dict) or not isinstance(row.get("text"), str) for row in rows):
        raise ValueError("Invalid OCR response")
    if expected is None:
        if rows:
            raise ValueError("Blank image produced OCR text")
    elif normalized(expected) not in normalized("".join(row["text"] for row in rows)):
        raise ValueError(f"Expected OCR text {expected!r}, received {rows!r}")


def request(base, endpoint, token, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(base + endpoint, data=data,
                                 headers={"Content-Type": "application/json", "Authorization": "Token " + token})
    with urllib.request.urlopen(req, timeout=10) as response:
        result = json.load(response)
    if result.get("code") != 0:
        raise ValueError(f"Kernel API failed: {endpoint}: {result}")
    return result["data"]


def verify_notebook(image, platform, version, timeout, fail_ocr, diagnostics=None):
    # 只使用本次测试创建的容器和卷，所有读写均发生在临时工作空间。
    name = "siyuan-docker-smoke-" + uuid.uuid4().hex
    volume, token = name + "-workspace", uuid.uuid4().hex
    run(["docker", "volume", "create", volume])
    try:
        run(["docker", "run", "--rm", "-i", "--platform", platform, "--entrypoint", "/bin/sh",
             "--mount", f"type=volume,src={volume},dst=/siyuan/workspace", image, "-ec",
             "mkdir -p /siyuan/workspace/conf; cat > /siyuan/workspace/conf/conf.json"],
            input=json.dumps({"api": {"token": token}, "ocr": {"auto": False}}))
        run(["docker", "run", "-d", "--name", name, "--platform", platform,
             "--mount", f"type=volume,src={volume},dst=/siyuan/workspace",
             "-p", "127.0.0.1::6806", image, "serve", "--port=6806", "--safe-mode",
             "--accessAuthCode=" + token])
        bindings = json.loads(run(["docker", "inspect", name]).stdout)[0]["NetworkSettings"]["Ports"]["6806/tcp"]
        base = "http://127.0.0.1:" + bindings[0]["HostPort"]
        deadline = time.monotonic() + timeout
        last_error = ""
        while True:
            try:
                progress = request(base, "/api/system/bootProgress", token)
                if progress["progress"] == 100:
                    break
            except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as error:
                # 端口转发已建立但内核尚未就绪时，HTTP 请求可能被重置或提前断开。
                last_error = str(error)
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Kernel did not boot: {platform}; last response: {last_error}")
            if run(["docker", "inspect", "--format", "{{.State.Running}}", name]).stdout.strip() != "true":
                raise RuntimeError("Kernel stopped before booting")
            time.sleep(2)
        if request(base, "/api/system/version", token) != version:
            raise ValueError("HTTP kernel version differs from release version")
        fail_ocr()
        notebook = request(base, "/api/notebook/createNotebook", token, {"name": "Docker OCR smoke"})
        block = request(base, "/api/filetree/createDocWithMd", token,
                        {"notebook": notebook["notebook"]["id"], "path": "/Docker smoke", "markdown": "Docker OCR smoke 123"})
        data = request(base, "/api/block/getBlockKramdown", token, {"id": block})
        if "Docker OCR smoke 123" not in data["kramdown"]:
            raise ValueError("Notebook write/read verification failed")
    except Exception:
        # 删除临时容器前保留启动日志和退出状态，采集失败不能覆盖原始验收错误。
        for filename, command in (("kernel.log", ["docker", "logs", name]),
                                  ("kernel-state.json", ["docker", "inspect", "--format", "{{json .State}}", name])):
            try:
                result = run(command, check=False, timeout=30)
                output = result.stdout + result.stderr
                print(f"{platform} {filename}:\n{output}", flush=True)
                if diagnostics is not None:
                    diagnostics.mkdir(parents=True, exist_ok=True)
                    (diagnostics / filename).write_text(output, encoding="utf-8")
            except Exception as error:
                print(f"Unable to collect {filename}: {error}", flush=True)
        raise
    finally:
        run(["docker", "rm", "-f", name], check=False)
        run(["docker", "volume", "rm", volume], check=False)


def verify_platform(repository, digest, platform, version, fixtures, timeout, diagnostics=None):
    started = time.monotonic()
    image = repository + "@" + digest
    architecture = platform.split("/")[1]
    runtime = "/opt/siyuan/stage/ocr/runtime/linux-" + architecture
    worker = runtime + "/siyuan-ocr"
    prefix = ["docker", "run", "--rm", "--platform", platform]
    checks = []
    run(["docker", "pull", "--platform", platform, image], timeout=900)
    # 辅助程序的动态链接由实际模型加载和识别验证，避免 musl 的 ldd 在 ARM32 模拟环境中误判。
    shell = f"test -s LICENSE && test -s THIRD_PARTY_NOTICES.md && test -s {runtime}/LICENSE " \
            f"&& test -s {runtime}/ThirdPartyNotices.txt && test -s {runtime}/onnx-toolchain.txt " \
            f"&& test -x {worker} && ldd {runtime}/libonnxruntime.so"
    run(prefix + ["--entrypoint", "/bin/sh", image, "-ec", shell])
    checks.append("licenses")
    output = run(prefix + ["--entrypoint", "/opt/siyuan/kernel", image, "--version"]).stdout
    if not re.search(r"\bversion\s+" + re.escape(version) + r"(?![\w.-])", output):
        raise ValueError(f"Unexpected kernel version: {output}")
    checks.append("version")
    worker_name = "siyuan-docker-ocr-" + uuid.uuid4().hex
    prefix += ["--name", worker_name, "-i", "--mount", f"type=bind,src={fixtures.resolve()},dst=/fixtures,readonly",
               "--entrypoint", worker, image]
    config = {"library": runtime + "/libonnxruntime.so", "directory": "/opt/siyuan/stage/ocr/models/tiny"}
    try:
        for name, expected in (("model-load", None), ("chinese", "思源笔记"), ("latin", "SiYuan OCR 123"), ("blank", None)):
            payload = {"config": config, "image": "" if name == "model-load" else f"/fixtures/{name}.png"}
            result = run(prefix, input=json.dumps(payload), timeout=timeout)
            validate_rows(result.stdout, expected)
            checks.append(name)

        # 模拟辅助进程加载失败，再验证已启动的内核仍可读写普通文档。
        def fail_ocr():
            bad = {"config": {**config, "library": runtime + "/missing-onnxruntime.so"}, "image": ""}
            failure = run(prefix, input=json.dumps(bad), timeout=timeout, check=False)
            if not failure.returncode or "missing-onnxruntime.so" not in failure.stderr:
                raise ValueError("Missing OCR runtime did not produce the expected failure")
            checks.append("worker-failure")

        verify_notebook(image, platform, version, timeout, fail_ocr, diagnostics)
        checks.append("notebook")
    finally:
        run(["docker", "rm", "-f", worker_name], check=False)
    return {"platform": platform, "digest": digest, "checks": checks, "seconds": round(time.monotonic() - started, 3)}


def verify(image, version, fixtures, report_path, timeout, *, platform=None, provenance=None):
    repository, separator, digest = image.partition("@")
    if not separator or not DIGEST.fullmatch(digest):
        raise ValueError("Verification requires an immutable image digest")
    for name in ("chinese", "latin", "blank"):
        if not (fixtures / f"{name}.png").is_file():
            raise ValueError(f"Missing OCR fixture: {name}")
    expected = (platform,) if platform else PLATFORMS
    index = manifests(json.loads(run(["docker", "buildx", "imagetools", "inspect", image, "--raw"]).stdout), expected)
    report = {"image": image, "version": version, "status": "running", "platforms": [], **(provenance or {})}
    try:
        for platform in expected:
            print(f"Verifying {platform} in Docker", flush=True)
            diagnostics = report_path.parent / "diagnostics" / platform.replace("/", "-")
            report["platforms"].append(verify_platform(repository, index[platform], platform, version, fixtures, timeout,
                                                       diagnostics=diagnostics))
        report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", error=str(error))
        raise
    finally:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def verified_platforms(report, image, version, expected=PLATFORMS):
    if report.get("image") != image or report.get("version") != version or report.get("status") != "passed":
        raise ValueError("Image promotion requires a matching successful verification report")
    platforms = report.get("platforms", [])
    if len(platforms) != len(expected) or {value.get("platform") for value in platforms} != set(expected):
        raise ValueError("Verification did not cover every release platform")
    for value in platforms:
        if set(value.get("checks", [])) != CHECKS or not DIGEST.fullmatch(value.get("digest", "")):
            raise ValueError("Incomplete platform verification")
    repository, separator, digest = image.partition("@")
    if not separator or not DIGEST.fullmatch(digest):
        raise ValueError("Image promotion requires an immutable digest")
    return {value["platform"]: value["digest"] for value in platforms}


def assemble(repository, tag, version, reports_path, report_path, provenance):
    # 重试失败任务时可复用同次运行中已通过的报告，但不接受其他运行或其他提交的产物。
    reports = sorted(reports_path.rglob("report.json"))
    if len(reports) != len(PLATFORMS):
        raise ValueError("Assembly requires exactly four platform reports")
    expected, sources, entries = {}, [], []
    for path in reports:
        report = json.loads(path.read_text(encoding="utf-8"))
        if any(report.get(key) != value for key, value in provenance.items()):
            raise ValueError("Platform report belongs to another source, configuration or workflow run")
        platform_entries = report.get("platforms", [])
        if len(platform_entries) != 1 or platform_entries[0].get("platform") not in PLATFORMS:
            raise ValueError("Expected one supported platform per report")
        platform = platform_entries[0]["platform"]
        image = report.get("image", "")
        if image.partition("@")[0] != repository or platform in expected:
            raise ValueError("Unexpected repository or duplicate platform report")
        verified = verified_platforms(report, image, version, (platform,))
        actual = manifests(json.loads(run(["docker", "buildx", "imagetools", "inspect", image, "--raw"]).stdout), (platform,))
        if actual != verified:
            raise ValueError("Platform report digest differs from candidate image")
        expected.update(verified)
        sources.append(image)
        entries.extend(platform_entries)
    if set(expected) != set(PLATFORMS):
        raise ValueError("Assembly is missing a release platform")
    candidate = repository + ":" + tag
    run(["docker", "buildx", "imagetools", "create", "--tag", candidate, *sources], timeout=900)
    descriptor = json.loads(run(["docker", "buildx", "imagetools", "inspect", candidate,
                                 "--format", "{{json .Manifest}}"]).stdout)
    digest = descriptor.get("digest", "")
    if not DIGEST.fullmatch(digest):
        raise ValueError("Missing assembled image digest")
    image = repository + "@" + digest
    actual = manifests(json.loads(run(["docker", "buildx", "imagetools", "inspect", image, "--raw"]).stdout))
    if actual != expected:
        raise ValueError("Assembled manifest differs from the verified platform images")
    report = {"image": image, "version": version, "status": "passed", "platforms": entries, **provenance}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def promote(image, version, report_path):
    report = json.loads(report_path.read_text(encoding="utf-8"))
    expected = verified_platforms(report, image, version)
    repository = image.partition("@")[0]
    actual = manifests(json.loads(run(["docker", "buildx", "imagetools", "inspect", image, "--raw"]).stdout))
    if actual != expected:
        raise ValueError("Candidate manifest differs from the verified image")
    run(["docker", "buildx", "imagetools", "create", "--tag", repository + ":v" + version,
         "--tag", repository + ":latest", image], timeout=900)
    for tag in (":v" + version, ":latest"):
        published = manifests(json.loads(run(["docker", "buildx", "imagetools", "inspect", repository + tag, "--raw"]).stdout))
        if published != expected:
            raise ValueError(f"Published manifest differs from the verified image: {tag}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify", "assemble", "promote"))
    parser.add_argument("--image")
    parser.add_argument("--version", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).parent / "testdata/docker-ocr")
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--platform", choices=PLATFORMS)
    parser.add_argument("--repository")
    parser.add_argument("--candidate-tag")
    parser.add_argument("--reports", type=Path)
    parser.add_argument("--source-commit")
    parser.add_argument("--configuration-commit")
    parser.add_argument("--run-id")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.version) or args.timeout <= 0:
        parser.error("Expected a stable release version and positive timeout")
    provenance = {"source_commit": args.source_commit, "configuration_commit": args.configuration_commit,
                  "run_id": args.run_id}
    if args.command == "assemble" or args.platform:
        if not all(re.fullmatch(r"[0-9a-f]{40}", value or "")
                   for value in (args.source_commit, args.configuration_commit)) or not re.fullmatch(r"[0-9]+", args.run_id or ""):
            parser.error("Platform verification requires pinned source/configuration commits and a workflow run ID")
    if args.command != "assemble" and not args.image:
        parser.error("Expected an immutable --image")
    if args.command == "verify":
        verify(args.image, args.version, args.fixtures, args.report, args.timeout,
               platform=args.platform, provenance=provenance if args.platform else None)
    elif args.command == "assemble":
        if not re.fullmatch(r"[a-z0-9][a-z0-9./_-]*", args.repository or "") \
                or not re.fullmatch(r"build-[0-9]+-[0-9]+-verified", args.candidate_tag or "") or not args.reports:
            parser.error("Expected a repository, reports directory and temporary build candidate tag")
        assemble(args.repository, args.candidate_tag, args.version, args.reports, args.report, provenance)
    else:
        promote(args.image, args.version, args.report)


if __name__ == "__main__":
    main()

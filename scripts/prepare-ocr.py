#!/usr/bin/env python3
"""下载并校验随应用分发的 OCR 模型和原生运行时；不在用户运行时下载。"""

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads(Path(__file__).with_name("ocr-assets.json").read_text(encoding="utf-8"))
STAGE = ROOT / "app/stage/ocr"


def digest(path, algorithm="sha256"):
    value = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def download(entry, destination):
    algorithm = "sha256" if "sha256" in entry else "sha512"
    if destination.is_file() and digest(destination, algorithm) == entry[algorithm]:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        handle, name = tempfile.mkstemp(prefix=destination.name + "-", suffix=".tmp", dir=destination.parent)
        os.close(handle)
        temporary = Path(name)
        try:
            ranged = False
            if entry.get("size", 0) > 4 * 1024 * 1024:
                try:
                    download_ranges(entry, temporary)
                    ranged = True
                except RangeUnsupported:
                    pass
            if not ranged:
                with urllib.request.urlopen(entry["url"], timeout=60) as source, temporary.open("wb") as target:
                    shutil.copyfileobj(source, target)
            if digest(temporary, algorithm) != entry[algorithm]:
                raise ValueError(f"Checksum mismatch: {entry['url']}")
            if "size" in entry and temporary.stat().st_size != entry["size"]:
                raise ValueError(f"Size mismatch: {entry['url']}")
            os.replace(temporary, destination)
            return
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 3:
                raise
            time.sleep(1)


class RangeUnsupported(Exception):
    pass


def download_ranges(entry, destination):
    size = entry["size"]
    chunk_size = 2 * 1024 * 1024
    with destination.open("wb") as stream:
        stream.truncate(size)

    def part(start):
        end = min(size, start + chunk_size) - 1
        request = urllib.request.Request(entry["url"], headers={"Range": f"bytes={start}-{end}"})
        with urllib.request.urlopen(request, timeout=60) as source:
            if source.status != 206 or source.headers.get("Content-Range") != f"bytes {start}-{end}/{size}":
                raise RangeUnsupported()
            data = source.read(end - start + 2)
        if len(data) != end - start + 1:
            raise ValueError("Truncated OCR resource range")
        with destination.open("r+b") as stream:
            stream.seek(start)
            stream.write(data)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(part, start) for start in range(0, size, chunk_size)]
        for future in futures:
            future.result()


def prepare_runtime(target, build_worker):
    entry = MANIFEST["runtime"][target]
    cache = Path(tempfile.gettempdir()) / "siyuan-ocr-assets" / entry["url"].rsplit("/", 1)[1]
    download(entry, cache)
    directory = STAGE / "runtime" / target
    directory.mkdir(parents=True, exist_ok=True)
    library = entry["library"]
    # 仅复制固定名称的库和许可证，归档路径不参与目标路径拼接。
    if zipfile.is_zipfile(cache):
        with zipfile.ZipFile(cache) as archive:
            files = archive.namelist()
            selected = next(name for name in files if name.endswith("/lib/" + library))
            (directory / library).write_bytes(archive.read(selected))
            for name in files:
                if name.rsplit("/", 1)[-1] in ("LICENSE", "ThirdPartyNotices.txt", "onnxruntime_providers_shared.dll"):
                    (directory / name.rsplit("/", 1)[-1]).write_bytes(archive.read(name))
    else:
        with tarfile.open(cache, "r:gz") as archive:
            files = [member for member in archive.getmembers() if member.isfile()]
            if "member" in entry:
                selected = next(member for member in files if member.name == entry["member"])
            else:
                selected = next(member for member in files if "/lib/" in member.name and member.name.rsplit("/", 1)[-1].startswith(library.split(".dylib")[0]) and ".a" not in member.name)
            with archive.extractfile(selected) as source, (directory / library).open("wb") as destination:
                shutil.copyfileobj(source, destination)
            for member in files:
                if member.name.rsplit("/", 1)[-1] in ("LICENSE", "ThirdPartyNotices.txt"):
                    with archive.extractfile(member) as source, (directory / member.name.rsplit("/", 1)[-1]).open("wb") as destination:
                        shutil.copyfileobj(source, destination)
    if target.startswith("linux-") and build_worker:
        architecture = target.split("-", 1)[1]
        environment = os.environ.copy()
        environment.update(GOOS="linux", GOARCH=architecture, CGO_ENABLED="1")
        environment["CC"] = "aarch64-linux-gnu-gcc" if architecture == "arm64" and os.uname().machine != "aarch64" else "gcc"
        subprocess.run(["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(directory / "siyuan-ocr"), "./ocr/cmd/ocr-worker"], cwd=ROOT / "kernel", env=environment, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", choices=["none", *MANIFEST.get("runtime", {})], default="none")
    parser.add_argument("--build-worker", action="store_true")
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(download, entry, STAGE / "models" / entry["path"]) for entry in MANIFEST["models"]]
        for future in futures:
            future.result()
    if args.runtime != "none":
        prepare_runtime(args.runtime, args.build_worker)
    print(f"OCR resources ready: {args.runtime}")


if __name__ == "__main__":
    main()

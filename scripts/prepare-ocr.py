#!/usr/bin/env python3
"""下载并校验随应用分发的 OCR 模型和原生运行时；不在用户运行时下载。"""

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import struct
import subprocess
import tarfile
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads(Path(__file__).with_name("ocr-assets.json").read_text(encoding="utf-8"))
STAGE = ROOT / "app/stage/ocr"


class WindowsDLL:
    """读取 PE 导入和导出，不执行待打包的原生代码。"""

    def __init__(self, path, target):
        self.path, self.data = path, path.read_bytes()
        pe = self.unpack("<I", 0x3c)[0]
        if self.data[:2] != b"MZ" or self.data[pe:pe + 4] != b"PE\0\0":
            raise ValueError(f"Invalid Windows DLL: {path}")
        machine, sections = self.unpack("<HH", pe + 4)
        optional_size, flags = self.unpack("<HH", pe + 20)
        optional = pe + 24
        if machine != {"windows-amd64": 0x8664, "windows-arm64": 0xaa64}[target] or not flags & 0x2000:
            raise ValueError(f"Windows DLL architecture does not match {target}: {path}")
        if self.unpack("<H", optional)[0] != 0x20b or optional_size < 224:
            raise ValueError(f"Unsupported Windows DLL header: {path}")
        if any(self.unpack("<II", optional + 112 + 13 * 8)):
            raise ValueError(f"Delay-loaded Windows DLL dependencies require packaging review: {path}")
        self.sections = [self.unpack("<IIII", optional + optional_size + index * 40 + 8)
                         for index in range(sections)]
        self.exports = set()
        exports, export_size = self.unpack("<II", optional + 112)
        if exports:
            base, count, names, functions, pointers, ordinals = self.unpack("<IIIIII", self.offset(exports) + 16)
            for index in range(count):
                function = self.unpack("<I", self.offset(functions) + index * 4)[0]
                if exports <= function < exports + export_size:
                    raise ValueError(f"Forwarded Windows DLL exports require packaging review: {path}")
                if function:
                    self.exports.add(base + index)
            for index in range(names):
                ordinal = self.unpack("<H", self.offset(ordinals) + index * 2)[0]
                if base + ordinal in self.exports:
                    self.exports.add(self.string(self.unpack("<I", self.offset(pointers) + index * 4)[0]))
        self.imports = {}
        imports, size = self.unpack("<II", optional + 120)
        for index in range(size // 20 if imports else 0):
            lookup, _, _, name, address = self.unpack("<IIIII", self.offset(imports) + index * 20)
            if not name:
                break
            symbols = set()
            offset = self.offset(lookup or address)
            while True:
                value = self.unpack("<Q", offset)[0]
                if not value:
                    break
                symbols.add(value & 0xffff if value & (1 << 63) else self.string(value + 2))
                offset += 8
            self.imports[self.string(name).lower()] = symbols

    def unpack(self, format, offset):
        try:
            return struct.unpack_from(format, self.data, offset)
        except struct.error as error:
            raise ValueError(f"Truncated Windows DLL: {self.path}") from error

    def offset(self, address):
        for _, virtual, size, raw in self.sections:
            if virtual <= address < virtual + size:
                return raw + address - virtual
        raise ValueError(f"Invalid Windows DLL address: {self.path}")

    def string(self, address):
        offset = self.offset(address)
        end = self.data.find(b"\0", offset)
        if end < 0:
            raise ValueError(f"Invalid Windows DLL string: {self.path}")
        return self.data[offset:end].decode("ascii")


def windows_crt_directory(target):
    architecture = "x64" if target == "windows-amd64" else "arm64"
    override = os.environ.get("SIYUAN_OCR_VC_REDIST_DIR")
    roots = [Path(override)] if override else []
    if not override:
        if os.environ.get("VCToolsRedistDir"):
            roots.append(Path(os.environ["VCToolsRedistDir"]))
        vswhere = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"
        if os.name == "nt" and vswhere.is_file():
            locations = subprocess.check_output([str(vswhere), "-all", "-products", "*", "-property", "installationPath", "-utf8"], encoding="utf-8")
            roots.extend(Path(location) / "VC/Redist/MSVC" for location in locations.splitlines() if location)
    required = {"msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll"}
    if architecture == "x64":
        required.add("vcruntime140_1.dll")
    errors = []
    for root in roots:
        candidates = ([root] if re.fullmatch(r"Microsoft\.VC\d+\.CRT", root.name, re.I) else
                      list(root.glob(f"{architecture}/Microsoft.VC*.CRT")) + list(root.glob(f"*/{architecture}/Microsoft.VC*.CRT")))
        candidates.sort(key=lambda path: tuple(int(value) for value in re.findall(r"\d+", path.parent.parent.name)), reverse=True)
        for directory in candidates:
            if not directory.is_dir() or "debug_nonredist" in {part.lower() for part in directory.parts}:
                continue
            files = {path.name.lower(): path for path in directory.iterdir() if path.is_file()}
            if not required <= files.keys():
                continue
            try:
                for name in required:
                    WindowsDLL(files[name], target)
                return directory
            except ValueError as error:
                errors.append(str(error))
    raise RuntimeError(f"Missing {architecture} Visual C++ CRT from a licensed Visual Studio installation. "
                       "Set SIYUAN_OCR_VC_REDIST_DIR to VC/Redist/MSVC/<version> or its Microsoft.VC*.CRT directory. "
                       + "; ".join(errors))


def prepare_windows_crt(target, directory, source):
    # 从已许可的 Visual Studio Redist 目录选择完整依赖闭包，不从系统目录收集 DLL。
    files = {path.name.lower(): path for path in source.iterdir() if path.is_file()}
    selected, parsed = {}, {}
    pending = [WindowsDLL(path, target) for path in directory.glob("onnxruntime*.dll")]
    while pending:
        library = pending.pop()
        for name, symbols in library.imports.items():
            if not re.fullmatch(r"(?:msvcp|vcruntime|concrt)\d[^/\\]*\.dll", name):
                continue
            if name not in files:
                raise RuntimeError(f"Missing Visual C++ dependency {name} required by {library.path.name}")
            if name not in parsed:
                parsed[name] = WindowsDLL(files[name], target)
            dependency = parsed[name]
            if not symbols <= dependency.exports:
                raise RuntimeError(f"Visual C++ dependency {name} is too old for {library.path.name}: missing exports")
            if name not in selected:
                selected[name] = files[name]
                pending.append(dependency)
    if not selected:
        raise RuntimeError("ONNX Runtime has no recognized Visual C++ dependencies")
    for path in directory.iterdir():
        if path.is_file() and re.fullmatch(r"(?:msvcp|vcruntime|concrt)\d[^/\\]*\.dll", path.name, re.I) and path.name.lower() not in selected:
            path.unlink()
    for name, path in selected.items():
        shutil.copyfile(path, directory / name)
    shutil.copyfile(ROOT / "scripts/ocr-vc-runtime-notice.txt", directory / "MICROSOFT-VC-RUNTIME-NOTICE.txt")
    (directory / "vc-runtime-files.json").write_text(json.dumps({name: digest(directory / name) for name in sorted(selected)}, indent=2) + "\n", encoding="utf-8")


def linux_worker_environment(target):
    architecture = target.split("-", 1)[1]
    triples = {"amd64": "x86_64-linux-gnu", "arm64": "aarch64-linux-gnu"}
    host = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(platform.machine().lower())
    variable = "SIYUAN_OCR_CC_" + architecture.upper()
    compiler = os.environ.get(variable) or ("gcc" if host == architecture and platform.system() == "Linux" else triples[architecture] + "-gcc")
    command = shlex.split(compiler)
    if not command or not shutil.which(command[0]):
        package = {"amd64": "gcc-x86-64-linux-gnu", "arm64": "gcc-aarch64-linux-gnu"}[architecture]
        raise RuntimeError(f"Missing OCR compiler {compiler}. Install gcc/{package} or set {variable} to a glibc target compiler")
    triple = subprocess.check_output(command + ["-dumpmachine"], encoding="utf-8").strip()
    if triple.split("-", 1)[0] != triples[architecture].split("-", 1)[0] or "-linux-gnu" not in triple:
        raise RuntimeError(f"OCR compiler {compiler} targets {triple}; {target} requires {triples[architecture]} (glibc)")
    macros = subprocess.check_output(command + ["-dM", "-E", "-x", "c", "-"], input="#include <features.h>\n", encoding="utf-8")
    if not re.search(r"^#define __GLIBC__ \d+$", macros, re.M):
        raise RuntimeError(f"OCR compiler {compiler} does not use glibc headers; musl wrappers cannot load the bundled runtime")
    environment = os.environ.copy()
    # 内核可使用 musl 静态链接；识别辅助进程必须匹配随包分发的 glibc 原生运行库。
    environment.update(GOOS="linux", GOARCH=architecture, CGO_ENABLED="1", CC=shlex.join(command))
    return environment


def runtime_prerequisites(target, build_worker):
    if target.startswith("windows-"):
        return windows_crt_directory(target)
    if target.startswith("linux-") and build_worker:
        return linux_worker_environment(target)
    return None


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


def prepare_runtime(target, build_worker, prerequisites=None):
    if prerequisites is None:
        prerequisites = runtime_prerequisites(target, build_worker)
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
    if target.startswith("windows-"):
        prepare_windows_crt(target, directory, prerequisites)
    if target.startswith("linux-") and build_worker:
        subprocess.run(["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(directory / "siyuan-ocr"), "./ocr/cmd/ocr-worker"], cwd=ROOT / "kernel", env=prerequisites, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", choices=["none", *MANIFEST.get("runtime", {})], default="none")
    parser.add_argument("--build-worker", action="store_true")
    parser.add_argument("--check-only", action="store_true", help="Check native packaging prerequisites without downloads or builds")
    args = parser.parse_args()
    if args.check_only and args.runtime == "none":
        parser.error("--check-only requires --runtime")
    prerequisites = runtime_prerequisites(args.runtime, args.build_worker)
    if args.check_only:
        print(f"OCR prerequisites ready: {args.runtime}")
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(download, entry, STAGE / "models" / entry["path"]) for entry in MANIFEST["models"]]
        for future in futures:
            future.result()
    if args.runtime != "none":
        prepare_runtime(args.runtime, args.build_worker, prerequisites)
    print(f"OCR resources ready: {args.runtime}")


if __name__ == "__main__":
    main()

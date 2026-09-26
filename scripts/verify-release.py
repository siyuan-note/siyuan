#!/usr/bin/env python3
"""直接检查发布安装包的内核版本、前端版本和资源引用，无需增加打包步骤。"""

import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from urllib.parse import unquote, urlsplit


REPO = Path(__file__).resolve().parents[1]
GROUPS = ("stage", "appearance", "guide", "changelogs")
PACKAGES = (".exe", ".zip", ".7z", ".tar.gz", ".tgz", ".deb", ".rpm",
            ".appimage", ".dmg", ".apk", ".aab", ".app", ".appx", ".msix")
SIDECARS = (".blockmap", ".yml", ".yaml", ".release-baseline.json")
KERNEL_NAMES = {"siyuan-kernel", "siyuan-kernel.exe", "libgojni.so", "libkernel.so"}
VERSION = r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z.-]+)?"
PACKAGE_VERSION = re.compile(r"^siyuan-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)(?:\.[0-9A-Za-z]+)*)?)(?=[-.])", re.I)


class VerificationError(Exception):
    pass


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def desktop_folder():
    if os.name == "nt":
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
            return Path(os.path.expandvars(winreg.QueryValueEx(key, "Desktop")[0])) / "siyuan"
    return Path.home() / "Desktop" / "siyuan"


def find_7z(explicit=None):
    candidates = [explicit, shutil.which("7zz"), shutil.which("7z")]
    if os.name == "nt":
        candidates += [str(Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "7-Zip/7z.exe"),
                       "D:/Program Files/7-Zip/7z.exe"]
    return next((str(Path(p).resolve()) for p in candidates if p and Path(p).is_file()), None)


def safe_name(name):
    path = PurePosixPath(name.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or any(":" in part for part in path.parts):
        raise VerificationError(f"归档包含不安全路径：{name}")
    return path


class Unpacker:
    def __init__(self, root, sevenzip=None):
        self.root = root
        self.sevenzip = sevenzip
        self.count = 0

    def extract_sevenzip(self, source, dest):
        if not self.sevenzip:
            raise VerificationError(f"解包 {source.name} 需要 7-Zip，请指定 --sevenzip")
        result = subprocess.run([self.sevenzip, "l", "-slt", "-sccUTF-8", str(source)],
                                capture_output=True, encoding="utf-8", errors="replace", timeout=600)
        if result.returncode:
            raise VerificationError(f"7-Zip 无法读取 {source.name}：{result.stderr.strip()}")
        listing = result.stdout.replace("\r\n", "\n").partition("----------\n")
        if not listing[1]:
            raise VerificationError(f"无法识别 7-Zip 文件清单：{source.name}")
        links = []
        for block in listing[2].split("\n\n"):
            properties = dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line)
            name = properties.get("Path")
            if name is None:
                continue
            safe_name(name)
            if properties.get("Symbolic Link") or properties.get("Mode", "").startswith("l"):
                links.append(name)
        command = [self.sevenzip, "x", "-y", "-bd", "-bso0", "-bsp0", "-sccUTF-8", f"-o{dest}"]
        # 与 ZIP/TAR 解包保持一致，跳过符号链接；必要资源仍由后续完整性检查确认。
        # 使用精确路径排除，避免通配符扩大范围；列表放在载荷目录之外。
        with tempfile.TemporaryDirectory(prefix="siyuan-7z-links-", dir=self.root) as temporary:
            if links:
                exclusions = Path(temporary) / "links.txt"
                exclusions.write_text("\n".join(links) + "\n", encoding="utf-8")
                command.extend(("-spd", "-scsUTF-8", f"-x@{exclusions}"))
            result = subprocess.run(command + [str(source)], capture_output=True,
                                    encoding="utf-8", errors="replace", timeout=600)
            if result.returncode:
                raise VerificationError(f"7-Zip 无法完整解包 {source.name}：{result.stderr.strip()}")

    def extract(self, source):
        self.count += 1
        if self.count > 64:
            raise VerificationError("嵌套归档超过 64 个，停止解包")
        dest = self.root / str(self.count)
        dest.mkdir()
        if zipfile.is_zipfile(source):
            with zipfile.ZipFile(source) as archive:
                names = set()
                for entry in archive.infolist():
                    name = safe_name(entry.filename).as_posix()
                    # Android 的 res 中存在仅大小写不同的原生外壳文件，Windows 无法同时落盘。
                    if source.suffix.lower() in {".apk", ".aab"}:
                        parts = PurePosixPath(name).parts
                        if not any(part in {"lib", "assets"} for part in parts):
                            continue
                    if name.casefold() in names:
                        raise VerificationError(f"归档路径重复：{name}")
                    names.add(name.casefold())
                    if stat.S_ISLNK(entry.external_attr >> 16):
                        continue
                    target = dest / name
                    if entry.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with archive.open(entry) as src, target.open("wb") as out:
                            shutil.copyfileobj(src, out)
        elif tarfile.is_tarfile(source):
            with tarfile.open(source) as archive:
                names = set()
                for entry in archive:
                    name = safe_name(entry.name).as_posix()
                    if not entry.isfile():
                        continue
                    if name.casefold() in names:
                        raise VerificationError(f"归档路径重复：{name}")
                    names.add(name.casefold())
                    target = dest / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(entry) as src, target.open("wb") as out:
                        shutil.copyfileobj(src, out)
        else:
            self.extract_sevenzip(source, dest)
        return dest

    def layers(self, package):
        queue = [self.extract(package)]
        result = []
        while queue:
            layer = queue.pop(0)
            result.append(layer)
            for path in sorted(layer.rglob("*")):
                if not path.is_file() or path.is_symlink():
                    continue
                name = path.name.lower()
                # 只展开安装器的载荷，包括鸿蒙 APP 内部的 HAP，不展开前端资源中的第三方归档。
                if (name == "app.zip" or name.endswith((".hap", ".appx", ".msix", ".cpio", ".hfs", ".img"))
                        or (name.startswith("app-") and name.endswith(".7z"))
                        or name.startswith("data.tar") or ".cpio." in name):
                    queue.append(self.extract(path))
        return result


def resource_files(root, partial=False):
    result = {}
    for group in GROUPS:
        folder = root / group
        if not folder.is_dir():
            if partial or group == "changelogs":
                continue
            raise VerificationError(f"缺少资源目录：{folder}")
        for path in sorted(folder.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            rel = path.relative_to(root)
            if any(part in {".git", ".idea", ".DS_Store", ".gitignore"} for part in rel.parts):
                continue
            result[rel.as_posix()] = digest(path)
    return result


def package_resources(layers, root):
    actual = resource_files(root, partial=True)
    # NSIS 将部分大文件放在外层 resources 中，合并同一逻辑目录的载荷。
    owner = next(layer for layer in layers if root.is_relative_to(layer))
    relative = root.relative_to(owner)
    for layer in layers:
        supplement = layer / relative
        if supplement == root or not supplement.is_dir():
            continue
        for name, checksum in resource_files(supplement, partial=True).items():
            if name in actual and actual[name] != checksum:
                raise VerificationError(f"安装器内外层资源冲突：{name}")
            actual[name] = checksum
    return actual


def resource_paths(layers, root):
    owner = next(layer for layer in layers if root.is_relative_to(layer))
    relative = root.relative_to(owner)
    result = {}
    for layer in layers:
        folder = layer / relative
        for group in GROUPS:
            for path in (folder / group).rglob("*"):
                if path.is_file() and not path.is_symlink():
                    result[path.relative_to(folder).as_posix()] = path
    return result


def kernel_files(layers):
    result = []
    for layer in layers:
        for path in sorted(layer.rglob("*")):
            if path.is_file() and not path.is_symlink() and path.name.lower() in KERNEL_NAMES:
                result.append(path)
    return result


def resource_roots(layers):
    return [path.parent for layer in layers for path in layer.rglob("stage")
            if path.is_dir() and (path / "build").is_dir()]


def compare_files(expected, actual):
    errors = []
    for name in sorted(expected.keys() - actual.keys()):
        errors.append(f"缺少资源：{name}")
    for name in sorted(actual.keys() - expected.keys()):
        errors.append(f"多余资源：{name}")
    for name in sorted(expected.keys() & actual.keys()):
        if expected[name] != actual[name]:
            errors.append(f"资源内容不匹配：{name}")
    return errors


def create_baseline(args):
    resources = args.resources.resolve()
    files = resource_files(resources)
    version = args.version
    if not version:
        version = json.loads((REPO / "app/package.json").read_text(encoding="utf-8"))["version"]
    for metadata in (resources / "package.json", resources / "app/package.json"):
        if metadata.is_file():
            actual_version = json.loads(metadata.read_text(encoding="utf-8")).get("version")
            if actual_version != version:
                raise VerificationError(f"资源目录的应用版本为 {actual_version}，与 {version} 不匹配")
    if "-" not in version and not any(name.startswith(f"changelogs/v{version}/") for name in files):
        raise VerificationError(f"资源缺少当前版本更新日志：v{version}")
    with tempfile.TemporaryDirectory(prefix="siyuan-baseline-") as temp:
        kernel = args.kernel.resolve()
        if kernel.suffix.lower() == ".aar":
            layers = Unpacker(Path(temp), find_7z(args.sevenzip)).layers(kernel)
            kernels = kernel_files(layers)
        elif kernel.is_dir():
            kernels = kernel_files([kernel])
        else:
            kernels = [kernel] if kernel.is_file() else []
        if not kernels:
            raise VerificationError("没有找到内核文件")
        hashes = sorted({digest(path) for path in kernels})
    manifest = {"schema": 1, "version": version, "target": args.target,
                "kernels": hashes, "resources": files}
    # 基准必须来自本次构建的可信输入，不能由待验安装包反向生成。
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(f"已生成基准：{args.output}（{len(hashes)} 个内核，{len(files)} 个资源）")


def load_baselines(paths, version):
    result = []
    for path in paths:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("schema") != 1 or value.get("version") != version:
            raise VerificationError(f"基准格式或版本不匹配：{path}")
        if not value.get("kernels") or not value.get("resources") or not value.get("target"):
            raise VerificationError(f"基准内容不完整：{path}")
        if not isinstance(value["resources"], dict) or not isinstance(value["kernels"], list):
            raise VerificationError(f"基准字段类型错误：{path}")
        for group in ("stage", "appearance", "guide"):
            if not any(name.startswith(group + "/") for name in value["resources"]):
                raise VerificationError(f"基准缺少 {group} 资源：{path}")
        for name in value["resources"]:
            safe_name(name)
        for checksum in [*value["kernels"], *value["resources"].values()]:
            if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
                raise VerificationError(f"基准摘要无效：{path}")
        value["file"] = str(path)
        result.append(value)
    return result


def binary_architecture(data):
    try:
        if data[:4] == b"\x7fELF":
            if data[4] not in (1, 2) or data[5] not in (1, 2):
                raise VerificationError("无效的 ELF 头")
            machine = struct.unpack_from("<H" if data[5] == 1 else ">H", data, 18)[0]
            return "ELF", {62: "amd64", 183: "arm64", 40: "arm", 3: "386"}.get(machine, str(machine))
        if data[:2] == b"MZ":
            offset = struct.unpack_from("<I", data, 60)[0]
            if data[offset:offset + 4] != b"PE\0\0":
                raise VerificationError("无效的 PE 头")
            machine = struct.unpack_from("<H", data, offset + 4)[0]
            return "PE", {0x8664: "amd64", 0xAA64: "arm64", 0x14C: "386"}.get(machine, str(machine))
        magic = data[:4]
        if magic in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce"):
            endian = "<" if magic[0] in (0xCF, 0xCE) else ">"
            cpu = struct.unpack_from(endian + "I", data, 4)[0]
            return "Mach-O", {0x1000007: "amd64", 0x100000C: "arm64"}.get(cpu, str(cpu))
        if magic in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
            count = struct.unpack_from(">I", data, 4)[0]
            size = 32 if magic[-1] == 0xBF else 20
            if not 1 <= count <= 16 or 8 + count * size > len(data):
                raise VerificationError("无效的通用 Mach-O 头")
            cpus = [struct.unpack_from(">I", data, 8 + i * size)[0] for i in range(count)]
            return "Mach-O", "+".join(sorted({{0x1000007: "amd64", 0x100000C: "arm64"}.get(cpu, str(cpu)) for cpu in cpus}))
    except (IndexError, struct.error) as error:
        raise VerificationError("内核二进制头不完整") from error
    raise VerificationError("内核不是可识别的 PE、ELF 或 Mach-O 二进制")


def kernel_info(path):
    data = path.read_bytes()
    binary_format, architecture = binary_architecture(data)
    # 此完整前缀由 model/export.go 中的 util.Ver 编译生成，不能用任意版本子串代替。
    versions = {match.decode("ascii") for match in re.findall(
        rb"SiYuan v(" + VERSION.encode("ascii") + rb") \(pdfcpu ", data)}
    versions.update(match.decode("ascii") for match in re.findall(
        rb"SiYuan Kernel v(" + VERSION.encode("ascii") + rb")\. Manage workspace data directly or start the HTTP server\.", data))
    if len(versions) != 1:
        raise VerificationError(f"{path.name} 无法唯一确定内核版本：{sorted(versions)}")
    return {"name": path.name, "version": versions.pop(), "format": binary_format,
            "architecture": architecture, "sha256": hashlib.sha256(data).hexdigest()}


def frontend_versions(text):
    versions = set()
    assignment = re.compile(r"\bSIYUAN_VERSION\s*=\s*(?:[\"'](" + VERSION + r")[\"']|([A-Za-z_$][\w$]*))")
    for match in assignment.finditer(text):
        if match[1]:
            versions.add(match[1])
            continue
        # 仅解析 Constants 模块内紧邻赋值的常量，不执行安装包里的 JavaScript。
        prefix = text[max(0, match.start() - 3000):match.start()]
        marker = prefix.rfind("Constants:")
        if marker < 0:
            marker = prefix.rfind("class Constants")
        if marker < 0:
            continue
        prefix = prefix[marker:]
        binding = re.compile(r"(?:\bconst\s+|\blet\s+|\bvar\s+|,)" + re.escape(match[2])
                             + r"\s*=\s*[\"'](" + VERSION + r")[\"']")
        candidates = {item[1] for item in binding.finditer(prefix)}
        if len(candidates) == 1:
            versions.update(candidates)
    return versions


class ResourceReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag in {"script", "img", "source"} and attrs.get("src"):
            self.urls.append(attrs["src"])
        if tag == "link" and attrs.get("href") and attrs.get("rel") != "manifest":
            self.urls.append(attrs["href"])


def resolve_resource(source, url):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or not parsed.path or "${" in url:
        return None
    path = unquote(parsed.path)
    if path.startswith("/"):
        if not path.startswith(("/stage/", "/appearance/")):
            return None
        return path.lstrip("/")
    result = posixpath.normpath(posixpath.join(posixpath.dirname(source), path))
    if result.startswith("../"):
        raise VerificationError(f"资源引用越界：{source} -> {url}")
    return result


def check_frontend_entries(paths, mobile):
    entries = ["stage/build/mobile/index.html"]
    if not mobile:
        # 桌面安装包同时提供主窗口、独立窗口及桌面和移动浏览器入口。
        entries.extend(("stage/build/app/index.html", "stage/build/app/window.html",
                        "stage/build/desktop/index.html"))
    errors = [f"缺少前端入口：{entry}" for entry in entries if entry not in paths]
    if "stage/build/export/protyle-method.js" not in paths:
        errors.append("缺少导出前端：stage/build/export/protyle-method.js")
    return errors


def check_frontend(paths, expected_version, mobile):
    errors = check_frontend_entries(paths, mobile)
    versions = {}
    html_files = [name for name in paths if name.startswith("stage/build/") and name.endswith(".html")]
    for name in html_files:
        parser = ResourceReferences()
        parser.feed(paths[name].read_text(encoding="utf-8"))
        found = set()
        for url in parser.urls:
            reference = resolve_resource(name, url)
            if reference is None:
                continue
            if reference not in paths:
                errors.append(f"资源引用缺失：{name} -> {reference}")
                continue
            if reference.endswith(".js") and reference.startswith("stage/build/"):
                found.update(frontend_versions(paths[reference].read_text(encoding="utf-8")))
        if found != {expected_version}:
            errors.append(f"前端版本不匹配或无法识别：{name}，实际 {sorted(found)}，预期 {expected_version}")
        versions[name] = sorted(found)
    export = "stage/build/export/protyle-method.js"
    if export in paths:
        found = frontend_versions(paths[export].read_text(encoding="utf-8"))
        if found != {expected_version}:
            errors.append(f"导出前端版本不匹配或无法识别：{sorted(found)}")
        versions[export] = sorted(found)
    for name, path in paths.items():
        if name.startswith("stage/build/") and name.endswith(".css"):
            for match in re.finditer(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", path.read_text(encoding="utf-8")):
                reference = resolve_resource(name, match[1].strip())
                if reference and reference not in paths:
                    errors.append(f"样式资源缺失：{name} -> {reference}")
        if name.startswith("stage/build/") and name.endswith(".js") and not Path(name).name.startswith("vendors"):
            text = path.read_text(encoding="utf-8")
            # 识别当前 webpack 生成的数字分块与内容哈希映射。
            for match in re.finditer(r'\.u=\w+=>""\+\w+\+"\."\+\{([^{}]+)\}\[\w+\]\+"\.js"', text):
                for chunk, checksum in re.findall(r'(\d+):"([0-9a-f]+)"', match[1]):
                    reference = posixpath.join(posixpath.dirname(name), f"{chunk}.{checksum}.js")
                    if reference not in paths:
                        errors.append(f"动态分块缺失：{name} -> {reference}")
    for group in ("appearance", "guide"):
        if not any(name.startswith(group + "/") for name in paths):
            errors.append(f"缺少或为空的资源目录：{group}")
    if "appearance/langs/en.json" not in paths:
        errors.append("缺少语言文件：appearance/langs/en.json")
    for name, path in paths.items():
        if name.startswith("appearance/langs/") and name.endswith(".json"):
            json.loads(path.read_text(encoding="utf-8"))
    if "-" not in expected_version and not any(name.startswith(f"changelogs/v{expected_version}/") for name in paths):
        errors.append(f"缺少当前版本更新日志：v{expected_version}")
    return versions, errors


def verify_package(package, baselines=None, sevenzip=None, version=None):
    if not package.name.lower().endswith(PACKAGES):
        raise VerificationError(f"不支持的安装包格式：{package.name}")
    with tempfile.TemporaryDirectory(prefix="siyuan-release-") as temp:
        layers = Unpacker(Path(temp), sevenzip).layers(package)
        kernels = kernel_files(layers)
        roots = resource_roots(layers)
        if not kernels:
            raise VerificationError("未找到可独立校验的内核")
        if len(roots) != 1:
            raise VerificationError(f"应找到一个完整前端资源目录，实际找到 {len(roots)} 个")
        kernel_hashes = sorted({digest(path) for path in kernels})
        actual = package_resources(layers, roots[0])
        mobile = package.suffix.lower() in {".apk", ".aab", ".app"}
        expected = version or (baselines[0]["version"] if baselines else None)
        if not expected:
            match = PACKAGE_VERSION.match(package.name)
            if not match:
                raise VerificationError("无法从包名确定发布版本，请指定 --version")
            expected = match[1]
        infos = [kernel_info(path) for path in kernels]
        errors = [f"内核版本不匹配：{info['name']} 为 {info['version']}，预期 {expected}"
                  for info in infos if info["version"] != expected]
        package_version = PACKAGE_VERSION.match(package.name)
        if package_version and package_version[1] != expected:
            errors.append(f"包名版本不匹配：{package_version[1]}，预期 {expected}")
        for info in infos:
            if "-arm64" in package.name.lower() and info["architecture"] != "arm64":
                errors.append(f"内核架构与包名不匹配：{info['architecture']}")
            if package.suffix.lower() in {".apk", ".aab", ".app"} and info["format"] != "ELF":
                errors.append(f"移动端内核格式不匹配：{info['format']}")
        for path, info in zip(kernels, infos):
            for abi, architecture in (("arm64-v8a", "arm64"), ("armeabi-v7a", "arm"), ("x86_64", "amd64"), ("x86", "386")):
                if abi in path.parts and info["architecture"] != architecture:
                    errors.append(f"内核架构与 ABI 目录 {abi} 不匹配：{info['architecture']}")
        paths = resource_paths(layers, roots[0])
        frontend, frontend_errors = check_frontend(paths, expected, mobile)
        errors.extend(frontend_errors)
        metadata = roots[0] / "app/package.json"
        if not mobile and not metadata.is_file():
            errors.append("缺少桌面外壳元数据：app/package.json")
        if metadata.is_file():
            metadata_value = json.loads(metadata.read_text(encoding="utf-8"))
            actual_version = metadata_value.get("version") if isinstance(metadata_value, dict) else None
            if actual_version != expected:
                errors.append(f"桌面外壳版本不匹配：{actual_version}，预期 {expected}")
        if errors:
            raise VerificationError("\n".join(errors[:40]))
        if baselines and any(b["version"] != expected for b in baselines):
            raise VerificationError("基准版本与预期发布版本不匹配")
        if not baselines:
            return {"target": ", ".join(f"{info['format']}/{info['architecture']}" for info in infos),
                    "version": expected, "kernels": infos, "frontend_versions": frontend,
                    "kernel_sha256": kernel_hashes, "resource_count": len(actual),
                    "scope": "包内版本及可解析资源引用检查；不证明同版本产物为最新构建"}
        candidates = [b for b in baselines if b["kernels"] == kernel_hashes]
        if not candidates:
            raise VerificationError("内核与所有基准均不匹配：可能漏拷贝内核、选错架构，或缺少该平台基准；"
                                    + "SHA-256=" + ",".join(kernel_hashes))
        comparisons = [(b, compare_files(b["resources"], actual)) for b in candidates]
        for baseline, errors in comparisons:
            if not errors:
                return {"target": baseline["target"], "baseline": baseline["file"],
                        "kernel_sha256": kernel_hashes, "resource_count": len(actual)}
        baseline, errors = min(comparisons, key=lambda pair: len(pair[1]))
        raise VerificationError(f"与基准 {baseline['target']} 比较，{len(errors)} 项资源不匹配：\n"
                                + "\n".join(errors[:30]))


def verify(args):
    folder = (args.directory or desktop_folder()).resolve()
    if not folder.is_dir():
        raise VerificationError(f"安装包目录不存在：{folder}")
    if args.report:
        args.report = args.report.resolve()
        if args.report.suffix.lower() != ".json" or args.report.exists():
            raise VerificationError("报告必须使用尚不存在的 .json 文件路径，避免覆盖已有文件")
    version = args.version
    paths = args.baseline or []
    packages = []
    unknown = []
    for path in sorted(folder.iterdir()):
        if path in paths or path == args.report:
            continue
        lower = path.name.lower()
        if lower in {"sha256sums.txt", "checksum.exe"} or lower.endswith(SIDECARS):
            continue
        if path.is_file() and lower.endswith(PACKAGES):
            packages.append(path)
        else:
            unknown.append(path.name)
    if not packages:
        raise VerificationError(f"没有安装包，不能判定通过：{folder}")
    if not version:
        versions = {match[1] for path in packages if (match := PACKAGE_VERSION.match(path.name))}
        if len(versions) != 1:
            raise VerificationError(f"包名中无法确定唯一发布版本：{sorted(versions)}，请指定 --version")
        version = versions.pop()
    if not re.fullmatch(VERSION, version):
        raise VerificationError(f"无效版本号：{version}")
    baselines = load_baselines(paths, version)
    print(f"预期发布版本：{version}；{'基准对比' if baselines else '直接检查安装包'}")
    report = {"version": version, "directory": str(folder), "unknown": unknown, "packages": []}
    failed = bool(unknown)
    for name in unknown:
        print(f"[FAIL] 未识别文件或目录：{name}")
    for package in packages:
        print(f"正在校验：{package.name}", flush=True)
        entry = {"name": package.name, "sha256": digest(package)}
        try:
            entry.update(verify_package(package, baselines, find_7z(args.sevenzip), version))
            entry["status"] = "PASS"
            detail = "摘要与基准一致" if baselines else "内核及前端版本检查通过"
            print(f"[PASS] {package.name}：{entry['target']}，{detail}，扫描 {entry['resource_count']} 个资源")
        except (VerificationError, OSError, ValueError, tarfile.TarError, zipfile.BadZipFile,
                subprocess.SubprocessError) as error:
            entry.update(status="FAIL", error=str(error))
            failed = True
            print(f"[FAIL] {package.name}：{error}")
        report["packages"].append(entry)
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"校验完成：{len(packages)} 个安装包，{'未通过' if failed else '全部通过'}")
    return 1 if failed else 0


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="校验目录中的所有安装包，默认桌面 siyuan 目录")
    check.add_argument("directory", nargs="?", type=Path)
    check.add_argument("--baseline", type=Path, action="append", help="可选，额外按可信基准比较完整摘要；通常无需使用")
    check.add_argument("--report", type=Path, help="写入 JSON 报告")
    baseline = sub.add_parser("baseline", help="从独立可信构建产物生成基准")
    baseline.add_argument("--resources", type=Path, required=True, help="包含 stage、appearance、guide、changelogs 的目录")
    baseline.add_argument("--kernel", type=Path, required=True, help="本次构建的内核文件、内核目录或 kernel.aar")
    baseline.add_argument("--target", required=True, help="平台及架构，例如 android-arm64、mac-arm64")
    baseline.add_argument("--output", type=Path, required=True, help="建议以 .release-baseline.json 结尾，不覆盖已有文件")
    for command in (check, baseline):
        command.add_argument("--version", help="预期发布版本；check 默认从包名推断，baseline 默认 app/package.json")
        command.add_argument("--sevenzip", help="7z 或 7zz 的可执行文件路径")
    args = parser.parse_args()
    try:
        if args.command == "baseline":
            create_baseline(args)
            return 0
        return verify(args)
    except (VerificationError, OSError, ValueError, KeyError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

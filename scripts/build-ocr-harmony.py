#!/usr/bin/env python3
"""使用鸿蒙 NDK 构建固定版本的 ONNX Runtime，不编译或启动思源内核。"""

import argparse
from contextlib import nullcontext
import hashlib
import inspect
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

REVISION = "3a728b75062256951b6e19ce718907cf1a1d4cf0"
SOURCE_PATHS = ["cmake", "include", "onnxruntime/core", "onnxruntime/contrib_ops/cpu", "onnxruntime/lora",
                "onnxruntime/tool", "tools", "LICENSE", "ThirdPartyNotices.txt", "VERSION_NUMBER"]


def replace_required(path, before, after):
    content = path.read_text(encoding="utf-8")
    if before not in content:
        raise ValueError(f"Unsupported ONNX Runtime source: {path}")
    path.write_text(content.replace(before, after), encoding="utf-8")


def patch_source(source):
    # FP32 和 INT8 使用 NEON，避开旧版鸿蒙 Clang 不支持的 BF16 快速路径和 FP16 向量指令。
    guard = "#if defined(__aarch64__) && defined(__linux__)"
    directories = [source / "onnxruntime/core/mlas", source / "onnxruntime/core/providers/cpu/math", source / "onnxruntime/contrib_ops/cpu"]
    for directory in directories:
        for path in directory.rglob("*"):
            if path.suffix not in (".h", ".cpp", ".cc"):
                continue
            content = path.read_text(encoding="utf-8")
            if guard in content:
                path.write_text(content.replace(guard, guard + " && !defined(__OHOS__)"), encoding="utf-8")
    replace_required(source / "onnxruntime/core/mlas/inc/mlas.h", "#if !defined(__APPLE__)", "#if !defined(__APPLE__) && !defined(__OHOS__)")
    # 鸿蒙未编译 I8MM 专用内核，量化分派和激活符号必须共同使用基础 NEON 路径。
    replace_required(
        source / "onnxruntime/core/mlas/lib/platform.cpp",
        "    const bool HasI8MMInstructions = MLAS_CPUIDINFO::GetCPUIDInfo().HasArmNeon_I8MM();\n"
        "    if (HasI8MMInstructions) {\n#if defined(__linux__)",
        "#if defined(__OHOS__)\n    const bool HasI8MMInstructions = false;\n#else\n"
        "    const bool HasI8MMInstructions = MLAS_CPUIDINFO::GetCPUIDInfo().HasArmNeon_I8MM();\n#endif\n"
        "    if (HasI8MMInstructions) {\n#if defined(__linux__) && !defined(__OHOS__)",
    )
    replace_required(source / "cmake/onnxruntime_mlas.cmake", "if (NOT APPLE)\n          set(mlas_platform_srcs", "if (NOT APPLE AND NOT SIYUAN_OHOS)\n          set(mlas_platform_srcs")
    replace_required(source / "cmake/CMakeLists.txt", 'if (NOT APPLE AND NOT CMAKE_SYSTEM_NAME STREQUAL "Emscripten" AND onnxruntime_target_platform STREQUAL "aarch64")', 'if (NOT APPLE AND NOT SIYUAN_OHOS AND NOT CMAKE_SYSTEM_NAME STREQUAL "Emscripten" AND onnxruntime_target_platform STREQUAL "aarch64")')
    replace_required(source / "onnxruntime/core/platform/posix/env.cc", "#if !defined(__APPLE__) && !defined(__ANDROID__) && !defined(__wasm__) && !defined(_AIX)", "#if !defined(__APPLE__) && !defined(__ANDROID__) && !defined(__wasm__) && !defined(_AIX) && !defined(__OHOS__)")
    # 动态库使用固定 SONAME，鸿蒙包内不需要版本号软链接。
    target = source / "cmake/onnxruntime.cmake"
    content = target.read_text(encoding="utf-8")
    content = re.sub(r"^[ \t]*(SOVERSION[ \t]+1|VERSION[ \t]+\$\{ORT_VERSION\})[ \t]*$", "", content, flags=re.MULTILINE)
    target.write_text(content, encoding="utf-8")


def export_source(checkout, destination):
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
    if revision != REVISION:
        raise ValueError(f"ONNX Runtime source must be {REVISION}, got {revision}")
    # 直接读取指定树中的对象，避免 git archive 在精简检出中预取整仓库的测试模型和 CUDA 数据。
    tree = subprocess.check_output(["git", "ls-tree", "-rz", REVISION, "--", *SOURCE_PATHS], cwd=checkout)
    with subprocess.Popen(["git", "cat-file", "--batch"], cwd=checkout,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE) as reader:
        try:
            for entry in tree.split(b"\0"):
                if not entry:
                    continue
                metadata, name = entry.split(b"\t", 1)
                mode, kind, object_id = metadata.split()
                # 子模块依赖由上游 CMake 按固定版本获取，与 git archive 的导出范围一致。
                if mode == b"160000" and kind == b"commit":
                    continue
                target = (destination / name.decode("utf-8")).resolve()
                if kind != b"blob" or mode not in (b"100644", b"100755") or not target.is_relative_to(destination.resolve()):
                    raise ValueError("Unsupported ONNX Runtime source entry")
                reader.stdin.write(object_id + b"\n")
                reader.stdin.flush()
                header = reader.stdout.readline().split()
                if len(header) != 3 or header[:2] != [object_id, b"blob"]:
                    raise ValueError(f"Cannot read ONNX Runtime source object: {object_id.decode()}")
                content = reader.stdout.read(int(header[2]))
                if len(content) != int(header[2]) or reader.stdout.read(1) != b"\n":
                    raise ValueError("Incomplete ONNX Runtime source object")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
                if mode == b"100755":
                    target.chmod(0o755)
        finally:
            reader.stdin.close()
        if reader.wait() != 0:
            raise RuntimeError("Cannot export ONNX Runtime source")


def prepare_work_directory(root, args):
    # 构建参数或源码适配变化时拒绝复用，防止混入其他架构和 SDK 的产物。
    signature = {
        "revision": REVISION,
        "paths": SOURCE_PATHS,
        "patch": hashlib.sha256(inspect.getsource(patch_source).encode()).hexdigest(),
        "arch": args.arch,
        "ndk": str(args.ndk.resolve()),
        "protoc": str(args.protoc.resolve()),
    }
    marker = root / "siyuan-ocr-build.json"
    if marker.exists():
        if json.loads(marker.read_text(encoding="utf-8")) != signature:
            raise ValueError(f"Build configuration changed; choose a new --work-dir: {root}")
        return root / "source"
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()):
        raise ValueError(f"Unrecognized or incomplete build directory; choose an empty --work-dir: {root}")
    source = root / "source"
    export_source(args.source, source)
    patch_source(source)
    marker.write_text(json.dumps(signature, indent=2) + "\n", encoding="utf-8")
    return source


def validate_runtime(library, ndk, arch):
    # 复制前验证目标架构和动态加载入口，避免把宿主机库或带版本号的库打入应用。
    with library.open("rb") as binary:
        header = binary.read(20)
    machine = 183 if arch == "arm64-v8a" else 62
    if len(header) != 20 or header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<HH", header, 16) != (3, machine):
        raise ValueError(f"Expected a 64-bit {arch} shared library: {library}")
    suffix = ".exe" if (ndk / "llvm/bin/llvm-readelf.exe").exists() else ""
    details = subprocess.check_output([str(ndk / ("llvm/bin/llvm-readelf" + suffix)),
                                       "--dynamic", "--dyn-syms", "--wide", str(library)], text=True)
    if not re.search(r"\(SONAME\).*\[libonnxruntime\.so\]", details):
        raise ValueError("ONNX Runtime SONAME must be libonnxruntime.so")
    if not re.search(r"\bGLOBAL\s+DEFAULT\s+\d+\s+OrtGetApiBase(?:@@\S+)?(?:\s|$)", details):
        raise ValueError("ONNX Runtime must export OrtGetApiBase")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Official ONNX Runtime v1.24.3 checkout")
    parser.add_argument("--ndk", required=True, type=Path, help="Harmony SDK native directory")
    parser.add_argument("--protoc", required=True, type=Path, help="Host protoc 3.21.12 executable")
    parser.add_argument("--output", required=True, type=Path, help="siyuan-harmony/entry/libs directory")
    parser.add_argument("--arch", choices=("arm64-v8a", "x86_64"), default="arm64-v8a")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--work-dir", type=Path, help="Retain sources, downloaded dependencies and build files for retries")
    parser.add_argument("--deps-mirror", type=Path, help="Local archive mirror arranged by upstream URL host and path")
    args = parser.parse_args()
    if not args.protoc.is_file() or args.jobs < 1:
        parser.error("A host protoc executable and positive job count are required")
    version = subprocess.check_output([str(args.protoc.resolve()), "--version"], text=True).strip()
    if version != "libprotoc 3.21.12":
        parser.error(f"Host protoc 3.21.12 is required, got {version}")
    ndk = args.ndk.resolve()
    suffix = ".exe" if (ndk / "llvm/bin/clang.exe").exists() else ""
    cmake = ndk / ("build-tools/cmake/bin/cmake" + suffix)
    if not cmake.is_file():
        parser.error("Harmony NDK CMake executable was not found")
    ninja = ndk / ("build-tools/cmake/bin/ninja" + suffix)
    if not ninja.is_file():
        parser.error("Harmony NDK Ninja executable was not found")
    # 所有源码适配只作用于构建副本，指定工作目录后可复用失败前已完成的下载和编译。
    working_directory = nullcontext(args.work_dir.resolve()) if args.work_dir else tempfile.TemporaryDirectory(prefix="siyuan-ocr-harmony-")
    with working_directory as working:
        root = Path(working)
        source = prepare_work_directory(root, args)
        toolchain = root / "toolchain.cmake"
        toolchain_content = (
            f'include("{(ndk / "build/cmake/ohos.toolchain.cmake").as_posix()}")\n'
            'set(CMAKE_SYSTEM_NAME Linux)\n'
            'foreach(language C CXX)\n'
            '  if(NOT CMAKE_${language}_FLAGS MATCHES "(^| )-D__OHOS__( |$)")\n'
            '    string(APPEND CMAKE_${language}_FLAGS " -D__OHOS__")\n'
            '  endif()\n'
            'endforeach()\n'
        )
        if not toolchain.exists() or toolchain.read_text(encoding="utf-8") != toolchain_content:
            toolchain.write_text(toolchain_content, encoding="utf-8")
        build = root / "build"
        configure = [str(cmake), "-S", str(source / "cmake"), "-B", str(build), "-G", "Ninja",
                     f"-DCMAKE_MAKE_PROGRAM={ninja.as_posix()}", f"-DCMAKE_TOOLCHAIN_FILE={toolchain.as_posix()}",
                     f"-DOHOS_ARCH={args.arch}", "-DCMAKE_BUILD_TYPE=Release", "-DSIYUAN_OHOS=ON",
                     "-Donnxruntime_CROSS_COMPILING=ON", "-Donnxruntime_BUILD_SHARED_LIB=ON",
                     "-Donnxruntime_BUILD_UNIT_TESTS=OFF", "-Donnxruntime_ENABLE_CPUINFO=OFF",
                     "-Donnxruntime_ENABLE_CPU_FP16_OPS=OFF", "-Donnxruntime_USE_KLEIDIAI=OFF",
                     "-Donnxruntime_USE_SVE=OFF", "-Donnxruntime_RUN_ONNX_TESTS=OFF",
                     "-DFLATBUFFERS_BUILD_FLATC=OFF",
                     "-Donnxruntime_DISABLE_EXTERNAL_INITIALIZERS=ON",
                     f"-DONNX_CUSTOM_PROTOC_EXECUTABLE={args.protoc.resolve().as_posix()}",
                     "--compile-no-warning-as-error"]
        if args.deps_mirror:
            configure.append(f"-Donnxruntime_CMAKE_DEPS_MIRROR_DIR={args.deps_mirror.resolve().as_posix()}")
        subprocess.run(configure, check=True)
        subprocess.run([str(cmake), "--build", str(build), "--target", "onnxruntime", "--parallel", str(args.jobs)], check=True)
        validate_runtime(build / "libonnxruntime.so", ndk, args.arch)
        destination = args.output.resolve() / args.arch
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(build / "libonnxruntime.so", destination / "libonnxruntime.so")
        for name in ("LICENSE", "ThirdPartyNotices.txt"):
            shutil.copyfile(source / name, destination / ("ONNXRUNTIME-" + name))
    print(f"Harmony OCR runtime ready: {destination}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""使用鸿蒙 NDK 构建固定版本的 ONNX Runtime，不编译或启动思源内核。"""

import argparse
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

REVISION = "3a728b75062256951b6e19ce718907cf1a1d4cf0"


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
    with tempfile.TemporaryFile() as archive:
        subprocess.run(["git", "archive", REVISION], cwd=checkout, stdout=archive, check=True)
        archive.seek(0)
        with tarfile.open(fileobj=archive) as source:
            for member in source.getmembers():
                target = (destination / member.name).resolve()
                if not target.is_relative_to(destination.resolve()) or member.issym() or member.islnk():
                    raise ValueError("Unsafe ONNX Runtime source archive")
            source.extractall(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Official ONNX Runtime v1.24.3 checkout")
    parser.add_argument("--ndk", required=True, type=Path, help="Harmony SDK native directory")
    parser.add_argument("--protoc", required=True, type=Path, help="Host protoc 3.21.12 executable")
    parser.add_argument("--output", required=True, type=Path, help="siyuan-harmony/entry/libs directory")
    parser.add_argument("--arch", choices=("arm64-v8a", "x86_64"), default="arm64-v8a")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    if not args.protoc.is_file() or args.jobs < 1:
        parser.error("A host protoc executable and positive job count are required")
    ndk = args.ndk.resolve()
    suffix = ".exe" if (ndk / "llvm/bin/clang.exe").exists() else ""
    cmake = ndk / ("build-tools/cmake/bin/cmake" + suffix)
    if not cmake.is_file():
        parser.error("Harmony NDK CMake executable was not found")
    ninja = ndk / ("build-tools/cmake/bin/ninja" + suffix)
    if not ninja.is_file():
        parser.error("Harmony NDK Ninja executable was not found")
    # 所有源码适配只作用于临时副本，保留原始上游检出目录。
    with tempfile.TemporaryDirectory(prefix="siyuan-ocr-harmony-") as working:
        root = Path(working)
        source = root / "source"
        export_source(args.source, source)
        patch_source(source)
        toolchain = root / "toolchain.cmake"
        toolchain.write_text(f'include("{(ndk / "build/cmake/ohos.toolchain.cmake").as_posix()}")\nset(CMAKE_SYSTEM_NAME Linux)\nset(CMAKE_C_FLAGS "${{CMAKE_C_FLAGS}} -D__OHOS__")\nset(CMAKE_CXX_FLAGS "${{CMAKE_CXX_FLAGS}} -D__OHOS__")\n', encoding="utf-8")
        build = root / "build"
        subprocess.run([str(cmake), "-S", str(source / "cmake"), "-B", str(build), "-G", "Ninja", f"-DCMAKE_MAKE_PROGRAM={ninja}", f"-DCMAKE_TOOLCHAIN_FILE={toolchain}", f"-DOHOS_ARCH={args.arch}", "-DCMAKE_BUILD_TYPE=Release", "-DSIYUAN_OHOS=ON", "-Donnxruntime_CROSS_COMPILING=ON", "-Donnxruntime_BUILD_SHARED_LIB=ON", "-Donnxruntime_BUILD_UNIT_TESTS=OFF", "-Donnxruntime_ENABLE_CPUINFO=OFF", "-Donnxruntime_ENABLE_CPU_FP16_OPS=OFF", "-Donnxruntime_USE_KLEIDIAI=OFF", "-Donnxruntime_USE_SVE=OFF", "-Donnxruntime_RUN_ONNX_TESTS=OFF", "-Donnxruntime_DISABLE_EXTERNAL_INITIALIZERS=ON", f"-DONNX_CUSTOM_PROTOC_EXECUTABLE={args.protoc.resolve()}", "--compile-no-warning-as-error"], check=True)
        subprocess.run([str(cmake), "--build", str(build), "--target", "onnxruntime", "--parallel", str(args.jobs)], check=True)
        destination = args.output.resolve() / args.arch
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(build / "libonnxruntime.so", destination / "libonnxruntime.so")
        for name in ("LICENSE", "ThirdPartyNotices.txt"):
            shutil.copyfile(source / name, destination / ("ONNXRUNTIME-" + name))
    print(f"Harmony OCR runtime ready: {destination}")


if __name__ == "__main__":
    main()

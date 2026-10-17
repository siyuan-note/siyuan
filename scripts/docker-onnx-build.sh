#!/bin/sh
set -eu

case "$ONNX_BUILD_PARALLEL" in
    ''|*[!0-9]*|0) echo "ONNX_BUILD_PARALLEL must be a positive integer" >&2; exit 1 ;;
esac

set -- onnxruntime_BUILD_UNIT_TESTS=OFF
printf 'target=%s\nhost=%s\n' "$TARGETPLATFORM" "$(uname -m)" >> /onnx-toolchain.txt
if [ "$TARGETARCH" = arm ]; then
    case "$TARGETVARIANT" in
        v7|v8) ;;
        *) echo "Unsupported ARM variant: $TARGETVARIANT" >&2; exit 1 ;;
    esac
    # 只提取目标开发文件，不运行 ARM 包内的安装脚本或编译器。
    mkdir -p /arm-sysroot/etc/apk/keys
    cp -L /usr/share/apk/keys/armv7/*.pub /arm-sysroot/etc/apk/keys/
    cp /etc/apk/repositories /arm-sysroot/etc/apk/repositories
    apk --arch armv7 --root /arm-sysroot --initdb --no-scripts \
        add --no-cache musl-dev gcc libstdc++-dev linux-headers
    apk --root /arm-sysroot info -v | sort >> /onnx-toolchain.txt

    # 先从 ONNX 锁定的依赖编译原生 protoc，避免版本不匹配或执行目标程序。
    python3 /onnxruntime/tools/ci_build/build.py --build_dir /onnxruntime/host \
        --config Release --update --skip_tests --allow_running_as_root \
        --compile_no_warning_as_error --cmake_extra_defines onnxruntime_BUILD_UNIT_TESTS=OFF
    cmake --build /onnxruntime/host/Release --target protoc --parallel "$ONNX_BUILD_PARALLEL"
    protoc=/onnxruntime/host/Release/_deps/protobuf-build/protoc
    test -x "$protoc"
    "$protoc" --version >> /onnx-toolchain.txt
    clang --version >> /onnx-toolchain.txt
    set -- "$@" CMAKE_TOOLCHAIN_FILE=/docker-onnx-toolchain.cmake ONNX_CUSTOM_PROTOC_EXECUTABLE="$protoc"
fi

python3 /onnxruntime/tools/ci_build/build.py --build_dir /onnxruntime/build \
    --config Release --update --build --parallel "$ONNX_BUILD_PARALLEL" --build_shared_lib \
    --skip_tests --allow_running_as_root --compile_no_warning_as_error --cmake_extra_defines "$@"
grep -q '^onnxruntime_BUILD_UNIT_TESTS:BOOL=OFF$' /onnxruntime/build/Release/CMakeCache.txt
mkdir -p /onnx-artifacts
cp "/onnxruntime/build/Release/libonnxruntime.so.${ONNX_VERSION}" /onnx-artifacts/libonnxruntime.so
cp /onnxruntime/LICENSE /onnxruntime/ThirdPartyNotices.txt /onnx-toolchain.txt /onnx-artifacts/
# 编译目录不进入可导出的缓存层，产物只保留运行库和溯源材料。
rm -rf /onnxruntime/build /onnxruntime/host /arm-sysroot

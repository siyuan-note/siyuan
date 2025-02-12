#!/bin/bash

export OHOS_NDK_HOME=/mnt/f/ohos-sdk-windows_linux-public/linux
export LOG_ADAPTOR_HOME=/mnt/f/log-adaptor

export CC=$OHOS_NDK_HOME/native/llvm/bin/clang
export CXX=$OHOS_NDK_HOME/native/llvm/bin/clang++
export AR=$OHOS_NDK_HOME/native/llvm/bin/llvm-ar
export AS=$OHOS_NDK_HOME/native/llvm/bin/llvm-as
export LD=$OHOS_NDK_HOME/native/llvm/bin/ld.lld
export STRIP=$OHOS_NDK_HOME/native/llvm/bin/llvm-strip
export RANLIB=$OHOS_NDK_HOME/native/llvm/bin/llvm-ranlib
export OBJDUMP=$OHOS_NDK_HOME/native/llvm/bin/llvm-objdump
export OBJCOPY=$OHOS_NDK_HOME/native/llvm/bin/llvm-objcopy
export NM=$OHOS_NDK_HOME/native/llvm/bin/llvm-nm
export CFLAGS="-target aarch64-linux-ohos --sysroot=${OHOS_NDK_HOME}/native/sysroot -D__MUSL__"
export CXXFLAGS="-target aarch64-linux-ohos --sysroot=${OHOS_NDK_HOME}/native/sysroot -D__MUSL__"
export LLVMCONFIG=$OHOS_NDK_HOME/native/llvm/bin/llvm-config

export GOPROXY=https://mirrors.aliyun.com/goproxy/
export CGO_ENABLED=1
export GOOS=android
export GOARCH=arm64
export CGO_CFLAGS="-I${LOG_ADAPTOR_HOME}/include -g -O2 `$LLVMCONFIG --cflags` --target=aarch64-linux-ohos --sysroot=$OHOS_NDK_HOME/native/sysroot"
export CGO_LDFLAGS="--target=aarch64-linux-ohos -fuse-ld=lld -L${LOG_ADAPTOR_HOME}/dist/arm64-v8a"

go build --tags fts5 -ldflags "-s -w" -buildmode=c-shared -v -o libkernel.so .

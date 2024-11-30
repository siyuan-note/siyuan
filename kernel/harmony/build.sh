#!/bin/bash

export GOPROXY=https://mirrors.aliyun.com/goproxy/
export CGO_ENABLED=1
export GOOS=android
export GOARCH=arm64
export CC=/mnt/f/ohos-sdk-windows_linux-public/linux/native/llvm/bin/aarch64-unknown-linux-ohos-clang
go build --tags fts5 -ldflags "-s -w" -buildmode=c-shared -v -o libkernel.so .

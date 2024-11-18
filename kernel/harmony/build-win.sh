#!/bin/bash

export GOPROXY=https://goproxy.io
export CGO_ENABLED=1
export GOOS=android
export GOARCH=amd64
export CC=/mnt/f/ohos-sdk-windows_linux-public/linux/native/llvm/bin/x86_64-unknown-linux-ohos-clang
go build --tags fts5 -ldflags "-s -w" -buildmode=c-shared -v -o libkernel.so .

ARG ALPINE_IMAGE=alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
ARG GO_IMAGE=golang:1.26-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca
ARG ONNX_VERSION=1.24.3
ARG ONNX_IMAGE=onnx-artifact

FROM --platform=$BUILDPLATFORM node:22@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8 AS node-build

ARG NPM_REGISTRY=

WORKDIR /app
ADD app/package.json app/pnpm* app/.npmrc .

RUN <<EORUN
#!/bin/bash -e
corepack enable
corepack install --global $(node -e 'console.log(require("./package.json").packageManager)')
npm config set registry ${NPM_REGISTRY}
pnpm install --silent
EORUN

ADD app/ .
COPY kernel/av/lunar_calendar_data.json /kernel/av/lunar_calendar_data.json
ADD scripts/prepare-ocr.py scripts/ocr-assets.json /scripts/
RUN <<EORUN
#!/bin/bash -e
apt-get update
apt-get install -y --no-install-recommends python3
python3 /scripts/prepare-ocr.py
pnpm run build
node scripts/trimChangelogs.js
mkdir /artifacts
mv appearance stage guide /artifacts/
if [ -d changelogs ]; then mv changelogs /artifacts/; fi
EORUN

FROM ${GO_IMAGE} AS go-source

RUN <<EORUN
#!/bin/sh -e
apk add --no-cache gcc musl-dev
go env -w GO111MODULE=on
go env -w CGO_ENABLED=1
EORUN

WORKDIR /kernel
ADD kernel/go.* .
RUN go mod download

ADD kernel/ .
FROM go-source AS go-build
RUN --mount=type=cache,target=/root/.cache/go-build \
    go build -tags "fts5 sqlcipher" -ldflags "-s -w"

FROM --platform=$BUILDPLATFORM ${ALPINE_IMAGE} AS onnx-source
ARG ONNX_COMMIT=3a728b75062256951b6e19ce718907cf1a1d4cf0
ARG ONNX_VERSION
RUN apk add --no-cache git
# 固定提交的源码在构建机上下载一次，网络中断时重试；子模块保持各自锁定的提交。
RUN <<EORUN
#!/bin/sh -e
retry() {
    attempt=1
    until "$@"; do
        if [ "$attempt" -ge 3 ]; then return 1; fi
        echo "Source download failed; retry $attempt/2" >&2
        sleep "$((attempt * 10))"
        attempt="$((attempt + 1))"
    done
}
git init /onnxruntime
cd /onnxruntime
git remote add origin https://github.com/microsoft/onnxruntime
git config http.version HTTP/1.1
git config remote.origin.promisor true
git config remote.origin.partialclonefilter blob:none
# 运行库不构建单元测试，避免下载体积较大的测试模型；编译源码和许可文件保持完整。
git sparse-checkout init --no-cone
git sparse-checkout set --no-cone '/*' '!/onnxruntime/test/testdata/' '!/winml/test/'
retry git fetch --filter=blob:none --depth=1 --no-tags origin "${ONNX_COMMIT}"
git checkout --detach FETCH_HEAD
test "$(git rev-parse HEAD)" = "${ONNX_COMMIT}"
# 源码版本不匹配时，在下载子模块和编译各平台之前停止。
test "$(cat VERSION_NUMBER)" = "${ONNX_VERSION}"
retry git -c http.version=HTTP/1.1 submodule update --init --recursive --depth=1
EORUN

FROM ${ALPINE_IMAGE} AS onnx-toolchain-native
ARG TARGETPLATFORM
ARG ONNX_TOOLCHAIN_REV=2
# ONNX 阶段只依赖 C++ 工具链和固定源码；更新工具链时递增修订号以刷新安装层。
RUN echo "${TARGETPLATFORM} toolchain revision ${ONNX_TOOLCHAIN_REV}" \
    && apk add --no-cache bash cmake make g++ git patch python3 py3-pip py3-packaging linux-headers \
    && apk info -v | sort > /onnx-toolchain.txt

FROM onnx-toolchain-native AS onnx-toolchain-amd64
FROM onnx-toolchain-native AS onnx-toolchain-arm64

FROM --platform=$BUILDPLATFORM ${ALPINE_IMAGE} AS onnx-toolchain-arm
ARG TARGETPLATFORM
ARG ONNX_TOOLCHAIN_REV=2
RUN echo "${TARGETPLATFORM} toolchain revision ${ONNX_TOOLCHAIN_REV}" \
    && apk add --no-cache bash cmake make g++ clang lld git patch python3 py3-pip py3-packaging linux-headers \
    && apk info -v | sort > /onnx-toolchain.txt

# ARM32 使用构建机编译器；其他平台保留目标环境编译，支持非原生的多平台构建。
FROM onnx-toolchain-${TARGETARCH} AS onnx-build
ARG TARGETARCH
ARG TARGETPLATFORM
ARG TARGETVARIANT
ARG ONNX_VERSION
COPY --from=onnx-source /onnxruntime /onnxruntime
COPY scripts/docker-onnx-toolchain.cmake scripts/docker-onnx-build.sh /
# Release 构建不生成栈回溯，将 execinfo.h 限定为 Debug 构建所需的头文件。
RUN <<EORUN
#!/bin/sh -e
cd /onnxruntime
patch --fuzz=0 -p1 <<'EOPATCH'
--- a/onnxruntime/core/platform/posix/stacktrace.cc
+++ b/onnxruntime/core/platform/posix/stacktrace.cc
@@ -6,4 +6,4 @@
-#if !defined(__ANDROID__) && !defined(__wasm__) && !defined(_OPSCHEMA_LIB_) && !defined(_AIX)
+#if !defined(NDEBUG) && !defined(__ANDROID__) && !defined(__wasm__) && !defined(_OPSCHEMA_LIB_) && !defined(_AIX)
 #include <execinfo.h>
 #endif
 #include <vector>
EOPATCH
EORUN
ARG ONNX_BUILD_PARALLEL=2
# 并行度只影响编译层，允许发布环境按可用资源调整。
RUN /bin/sh /docker-onnx-build.sh

FROM ${ALPINE_IMAGE} AS onnx-artifact
ARG ONNX_INPUT_KEY
ARG TARGETPLATFORM
ARG ONNX_VERSION
LABEL org.siyuan.onnx.inputs="${ONNX_INPUT_KEY}" org.siyuan.onnx.platform="${TARGETPLATFORM}" org.siyuan.onnx.version="${ONNX_VERSION}"
RUN apk add --no-cache libstdc++
COPY --from=onnx-build /onnx-artifacts /onnx-artifacts

# 发布构建传入不可变的产物摘要；未指定时仍支持从源码独立构建。
FROM ${ONNX_IMAGE} AS onnx-runtime

FROM go-source AS ocr-build
ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build \
    mkdir -p /ocr/linux-${TARGETARCH} \
    && go build -trimpath -ldflags "-s -w" -o /ocr/linux-${TARGETARCH}/siyuan-ocr ./ocr/cmd/ocr-worker
COPY --from=onnx-runtime /onnx-artifacts/ /ocr/linux-${TARGETARCH}/

FROM ${ALPINE_IMAGE}
LABEL maintainer="Liang Ding<845765@qq.com>"

RUN apk add --no-cache 'ca-certificates>=20261020-r0' tzdata su-exec libstdc++

ENV TZ=Asia/Shanghai
ENV HOME=/home/siyuan
ENV RUN_IN_CONTAINER=true
EXPOSE 6806

WORKDIR /opt/siyuan/
COPY --from=go-build --chmod=755 /kernel/kernel /kernel/entrypoint.sh .
COPY --from=node-build /artifacts .
COPY --from=ocr-build /ocr stage/ocr/runtime
COPY LICENSE THIRD_PARTY_NOTICES.md .

ENTRYPOINT ["/opt/siyuan/entrypoint.sh"]
# 默认启动伺服。若通过 `docker run` / `command:` 传额外参数，需自行带上 `serve` 子命令，
# 否则用户参数会整体覆盖 CMD。
CMD ["serve"]

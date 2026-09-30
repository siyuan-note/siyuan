FROM --platform=$BUILDPLATFORM node:22 AS node-build

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

FROM golang:1.26-alpine AS go-build

RUN <<EORUN
#!/bin/sh -e
apk add --no-cache gcc musl-dev
go env -w GO111MODULE=on
go env -w CGO_ENABLED=1
EORUN

WORKDIR /kernel
ADD kernel/go.* .
RUN --mount=type=cache,target=/root/.cache/go-build --mount=type=cache,target=/go/pkg \
    go mod download

ADD kernel/ .
RUN --mount=type=cache,target=/root/.cache/go-build --mount=type=cache,target=/go/pkg \
    go build -tags "fts5 sqlcipher" -ldflags "-s -w"

FROM go-build AS ocr-build
ARG TARGETARCH
# 容器保留 Alpine 基础镜像，使用 musl 构建原生运行时和识别辅助进程。
RUN apk add --no-cache bash cmake make g++ git python3 py3-pip py3-packaging linux-headers
RUN git clone --no-checkout https://github.com/microsoft/onnxruntime /onnxruntime \
    && cd /onnxruntime \
    && git checkout 3a728b75062256951b6e19ce718907cf1a1d4cf0 \
    && git submodule update --init --recursive
RUN python3 /onnxruntime/tools/ci_build/build.py --build_dir /onnxruntime/build \
    --config Release --update --build --parallel 2 --build_shared_lib \
    --skip_tests --allow_running_as_root --compile_no_warning_as_error
RUN mkdir -p /ocr/linux-${TARGETARCH} \
    && cp /onnxruntime/build/Release/libonnxruntime.so.1.24.3 /ocr/linux-${TARGETARCH}/libonnxruntime.so \
    && cp /onnxruntime/LICENSE /onnxruntime/ThirdPartyNotices.txt /ocr/linux-${TARGETARCH}/ \
    && go build -trimpath -ldflags "-s -w" -o /ocr/linux-${TARGETARCH}/siyuan-ocr ./ocr/cmd/ocr-worker

FROM alpine:latest
LABEL maintainer="Liang Ding<845765@qq.com>"

RUN apk add --no-cache ca-certificates tzdata su-exec libstdc++

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
CMD ["/opt/siyuan/kernel", "serve"]

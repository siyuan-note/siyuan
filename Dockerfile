FROM node:21 AS NODE_BUILD

WORKDIR /go/src/github.com/siyuan-note/siyuan/
ADD . /go/src/github.com/siyuan-note/siyuan/
RUN apt-get update && \
    apt-get install -y jq
RUN cd app && \
packageManager=$(jq -r '.packageManager' package.json) && \
if [ -n "$packageManager" ]; then \
    npm install -g $packageManager; \
else \
    echo "No packageManager field found in package.json"; \
    npm install -g pnpm; \
fi && \
pnpm install --registry=http://registry.npmjs.org/ --silent && \
pnpm run build
RUN apt-get purge -y jq
RUN apt-get autoremove -y
RUN rm -rf /var/lib/apt/lists/*

FROM golang:alpine AS GO_BUILD
WORKDIR /go/src/github.com/siyuan-note/siyuan/
COPY --from=NODE_BUILD /go/src/github.com/siyuan-note/siyuan/ /go/src/github.com/siyuan-note/siyuan/
ENV GO111MODULE=on
ENV CGO_ENABLED=1
RUN apk add --no-cache gcc musl-dev && \
    cd kernel && go build --tags fts5 -v -ldflags "-s -w" && \
    mkdir /opt/siyuan/ && \
    mv /go/src/github.com/siyuan-note/siyuan/app/appearance/ /opt/siyuan/ && \
    mv /go/src/github.com/siyuan-note/siyuan/app/stage/ /opt/siyuan/ && \
    mv /go/src/github.com/siyuan-note/siyuan/app/guide/ /opt/siyuan/ && \
    mv /go/src/github.com/siyuan-note/siyuan/app/changelogs/ /opt/siyuan/ && \
    mv /go/src/github.com/siyuan-note/siyuan/kernel/kernel /opt/siyuan/ && \
    find /opt/siyuan/ -name .git | xargs rm -rf

FROM alpine:latest
LABEL maintainer="Liang Ding<845765@qq.com>"

# Set default values in case PUID/PGID are not provided
ARG USER_ID=1000
ARG GROUP_ID=1000

ENV PUID $USER_ID
ENV PGID $GROUP_ID

WORKDIR /opt/siyuan/
COPY --from=GO_BUILD /opt/siyuan/ /opt/siyuan/

# Create User and Group
RUN if ! getent group ${PGID}; then \
      addgroup --gid ${PGID} siyuan; \
    else \
      groupname=$(getent group ${PGID} | cut -d: -f1); \
      echo "Group with GID ${PGID} already exists, using group: $groupname"; \
    fi && \
    adduser --uid ${PUID} --ingroup ${groupname:-siyuan} --disabled-password siyuan && \
    chown -R siyuan:${groupname:-siyuan} /opt/siyuan/

RUN apk add --no-cache ca-certificates tzdata

ENV TZ=Asia/Shanghai
ENV HOME=/home/siyuan
ENV RUN_IN_CONTAINER=true
EXPOSE 6806

USER siyuan

ENTRYPOINT ["/opt/siyuan/kernel"]

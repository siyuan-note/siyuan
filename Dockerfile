FROM debian:bookworm-slim

ARG SIYUAN_VERSION=3.1.30
ARG SIYUAN_ARCH=linux
ARG SIYUAN_PACKAGE=siyuan-${SIYUAN_VERSION}-${SIYUAN_ARCH}.tar.gz

RUN apt-get update -y &&         apt-get install -y curl wget tar gzip ca-certificates gnupg &&         rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&         apt-get install -y nodejs

RUN mkdir -p /opt/siyuan &&         wget -qO - https://github.com/siyuan-note/siyuan/releases/download/v${SIYUAN_VERSION}/${SIYUAN_PACKAGE} |         tar -xz --strip-components=1 -C /opt/siyuan &&         chmod +x /opt/siyuan/siyuan

WORKDIR /app/discord-auth
COPY discord-auth/package.json ./package.json
RUN npm install --omit=dev

WORKDIR /app
COPY discord-auth/server.js ./discord-auth/server.js
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV TZ=Asia/Singapore
ENV PORT=6806
ENV SIYUAN_INTERNAL_PORT=6807

EXPOSE 6806
EXPOSE 6807

CMD ["/start.sh"]

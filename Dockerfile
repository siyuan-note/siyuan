FROM debian:bookworm-slim

ARG SIYUAN_VERSION=3.1.30
ARG SIYUAN_ARCH=linux
ARG SIYUAN_PACKAGE=siyuan-${SIYUAN_VERSION}-${SIYUAN_ARCH}.tar.gz

# Core + Electron runtime libs
RUN apt-get update -y &&         DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends         curl wget tar gzip ca-certificates gnupg         libglib2.0-0 libnss3 libatk-bridge2.0-0 libx11-xcb1         libgtk-3-0 libxcomposite1 libxrandr2 libxdamage1 libasound2         libxss1 libpango-1.0-0 libpangocairo-1.0-0 libfontconfig1 libxext6         libgbm1 libdrm2 libxcb-dri3-0 libxshmfence1 libegl1         xdg-utils &&         rm -rf /var/lib/apt/lists/*

# Node 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&         apt-get update -y && apt-get install -y nodejs &&         rm -rf /var/lib/apt/lists/*

# Install SiYuan
RUN mkdir -p /opt/siyuan &&         wget -qO - https://github.com/siyuan-note/siyuan/releases/download/v${SIYUAN_VERSION}/${SIYUAN_PACKAGE} |         tar -xz --strip-components=1 -C /opt/siyuan &&         chmod +x /opt/siyuan/siyuan

# Copy proxy
WORKDIR /app/discord-auth
COPY discord-auth/package.json .
RUN npm install --omit=dev

WORKDIR /app
COPY discord-auth/server.js ./discord-auth/server.js
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV TZ=Asia/Singapore
ENV PORT=6806
ENV SIYUAN_INTERNAL_PORT=6807

EXPOSE 6806 6807

CMD ["/start.sh"]

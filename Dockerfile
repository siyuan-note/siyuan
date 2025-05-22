FROM debian:bookworm-slim

ARG SIYUAN_VERSION=3.1.30
ARG SIYUAN_ARCH=linux
ARG SIYUAN_PACKAGE=siyuan-${SIYUAN_VERSION}-${SIYUAN_ARCH}.tar.gz

# Install Electron/Chromium runtime dependencies
RUN apt-get update -y &&         DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends         ca-certificates curl wget gnupg gzip tar xdg-utils         libasound2 libatk1.0-0 libatk-bridge2.0-0 libappindicator3-1         libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3         libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1         libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1         libxss1 libxtst6 libxkbcommon0 libpangocairo-1.0-0 libpango-1.0-0         libcups2 libfontconfig1 &&         rm -rf /var/lib/apt/lists/*

# Node 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&         apt-get update -y && apt-get install -y --no-install-recommends nodejs &&         rm -rf /var/lib/apt/lists/*

# Install SiYuan binary
RUN mkdir -p /opt/siyuan &&         wget -qO - https://github.com/siyuan-note/siyuan/releases/download/v${SIYUAN_VERSION}/${SIYUAN_PACKAGE} |         tar -xz --strip-components=1 -C /opt/siyuan &&         chmod +x /opt/siyuan/siyuan

# Copy proxy files
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

CMD ["/start.sh"]

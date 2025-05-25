FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG SIYUAN_VERSION=3.1.30
ARG SIYUAN_PACKAGE=siyuan-${SIYUAN_VERSION}-linux.tar.gz

# Install required packages including iproute2 for ss command
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
    curl wget tar gzip ca-certificates gnupg \
    xvfb fluxbox dbus dbus-x11 xdg-utils \
    libnss3 libasound2 libxss1 libatk-bridge2.0-0 libgtk-3-0 \
    libx11-xcb1 libxcb-dri3-0 libdrm2 libgbm1 libxshmfence1 libegl1 \
    libxcomposite1 libxdamage1 libxrandr2 libu2f-udev iproute2 && \
    mkdir -p /run/dbus && \
    rm -rf /var/lib/apt/lists/*

# Node 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update -y && apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install SiYuan
RUN mkdir -p /opt/siyuan && \
    wget -qO - https://github.com/siyuan-note/siyuan/releases/download/v${SIYUAN_VERSION}/${SIYUAN_PACKAGE} | \
    tar -xz --strip-components=1 -C /opt/siyuan && \
    chmod +x /opt/siyuan/siyuan

WORKDIR /app/discord-auth
COPY discord-auth/package.json .
RUN npm install --omit=dev

WORKDIR /app
COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV TZ=Asia/Singapore
ENV PORT=6806
ENV SIYUAN_INTERNAL_PORT=6807

EXPOSE 6806

CMD ["/start.sh"]

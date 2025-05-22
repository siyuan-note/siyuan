FROM debian:bookworm-slim

# Install dependencies
RUN apt-get update -y &&         apt-get install -y curl wget tar gnupg unzip &&         rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&         apt-get install -y nodejs

# Install SiYuan (server build)
ARG SIYUAN_VERSION=3.1.30
ARG SIYUAN_ARCH=linux
ARG SIYUAN_PACKAGE=siyuan-${SIYUAN_VERSION}-${SIYUAN_ARCH}.tar.gz

RUN mkdir -p /opt &&         wget -qO /tmp/siyuan.tgz https://github.com/siyuan-note/siyuan/releases/download/v${SIYUAN_VERSION}/${SIYUAN_PACKAGE} &&         tar -xzf /tmp/siyuan.tgz -C /opt &&         rm /tmp/siyuan.tgz &&         mv /opt/siyuan-${SIYUAN_VERSION} /opt/siyuan &&         chmod +x /opt/siyuan/siyuan

WORKDIR /app

# Copy proxy
COPY discord-auth/package.json ./discord-auth/package.json
COPY discord-auth/server.js ./discord-auth/server.js
RUN cd discord-auth && npm install --omit=dev

COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV PORT=6806
ENV TZ=Asia/Singapore
EXPOSE 6806 6807

CMD ["/start.sh"]

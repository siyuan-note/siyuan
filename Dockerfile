FROM debian:bookworm-slim

# Install dependencies
RUN apt-get update -y &&         apt-get install -y curl wget unzip gnupg &&         rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - &&         apt-get install -y nodejs &&         npm install -g pnpm

# Install SiYuan (headless/server build)
ENV SIYUAN_VERSION=3.1.1
RUN mkdir -p /opt &&         wget -qO /tmp/siyuan.zip https://github.com/siyuan-note/siyuan/releases/download/v${SIYUAN_VERSION}/siyuan-linux-amd64-${SIYUAN_VERSION}.zip &&         unzip /tmp/siyuan.zip -d /opt &&         rm /tmp/siyuan.zip &&         mv /opt/siyuan-* /opt/siyuan &&         chmod +x /opt/siyuan/siyuan

WORKDIR /app

# Copy proxy
COPY discord-auth/package.json ./discord-auth/package.json
COPY discord-auth/server.js ./discord-auth/server.js
RUN cd discord-auth && npm install --omit=dev

COPY start.sh /start.sh
RUN chmod +x /start.sh

ENV PORT=3000
EXPOSE 3000
EXPOSE 6806

CMD ["/start.sh"]

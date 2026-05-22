FROM node:22-bookworm

# node-pty build tools + python for whisper
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    make \
    g++ \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install faster-whisper (local offline speech-to-text)
RUN python3 -m venv /opt/whisper && \
    /opt/whisper/bin/pip install faster-whisper

WORKDIR /app

# Copy package files first for layer caching
COPY service/be/package.json service/be/package-lock.json* ./

RUN npm install

COPY docker/manager/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3456

ENTRYPOINT ["docker-entrypoint.sh"]

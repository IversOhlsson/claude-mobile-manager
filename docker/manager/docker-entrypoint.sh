#!/bin/bash
set -e
cd /app

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start whisper server in background (persists across tsx watch restarts)
echo "Starting Whisper server..."
nohup /opt/whisper/bin/python3 /app/src/whisper_server.py > /tmp/whisper.log 2>&1 &

# Wait for whisper to load
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:9876 > /dev/null 2>&1; then
        echo "Whisper ready"
        break
    fi
    sleep 1
done

echo "Starting Claude Code Manager..."
exec npx tsx watch src/server.ts

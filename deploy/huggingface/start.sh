#!/bin/sh
# Starts the scanner, waits until its models are loaded, then the website + API.
set -e
cd /app/apps/vision
python -m uvicorn naily_vision.server:app --host 127.0.0.1 --port 8790 &
until python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8790/health')" 2>/dev/null; do sleep 1; done
cd /app/apps/server
exec node --import tsx src/index.ts

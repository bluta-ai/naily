# One container with everything (website + API + scanner), for Hugging Face Spaces or any
# single-container host. Run `python apps/vision/fetch_models.py` first, then from the repo root:
#   docker build -f deploy/huggingface/Dockerfile -t naily .

# 1. Website + API
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/web ./apps/web
RUN npm run build

# 2. Runtime
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libegl1 libgles2 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY apps/vision/requirements.txt apps/vision/
RUN pip install --no-cache-dir -r apps/vision/requirements.txt
COPY --from=web /app /app
COPY apps/vision/naily_vision apps/vision/naily_vision
COPY apps/vision/models/*.onnx apps/vision/models/*.task apps/vision/models/
COPY deploy/huggingface/start.sh /start.sh
RUN chmod +x /start.sh && useradd -m -u 1000 user && mkdir -p /data && chown user /data
USER user
ENV PORT=7860 NAILY_DB=/data/naily.sqlite VISION_URL=http://127.0.0.1:8790
EXPOSE 7860
CMD ["/start.sh"]

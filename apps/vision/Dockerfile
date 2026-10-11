# Stage 1: download the models and export the nail detector to ONNX.
FROM python:3.12-slim AS models
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY fetch_models.py .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && python fetch_models.py

# Stage 2: the scanner itself, without PyTorch.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libegl1 libgles2 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY naily_vision ./naily_vision
COPY --from=models /app/models/*.onnx /app/models/*.task ./models/
EXPOSE 8790
CMD ["uvicorn", "naily_vision.server:app", "--host", "0.0.0.0", "--port", "8790"]

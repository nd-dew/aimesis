# Stage 1: Build React Frontend
FROM node:20-slim AS frontend-builder
WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend with uv runner
FROM python:3.12-slim
WORKDIR /app/backend

ENV PYTHONUNBUFFERED=1

COPY --from=ghcr.io/astral-sh/uv:0.10.8 /uv /uvx /bin/

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

COPY backend/app ./app
COPY backend/data ./data
RUN rm -rf data/runtime

COPY --from=frontend-builder /frontend/dist /app/frontend/dist

CMD ["sh", "-c", "uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]

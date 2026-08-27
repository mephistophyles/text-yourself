# syntax=docker/dockerfile:1.7

FROM node:22.19.0-bookworm-slim AS web-builder

WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build


FROM python:3.13.7-slim-bookworm AS python-builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN python -m venv "${VIRTUAL_ENV}"
WORKDIR /build
COPY requirements.txt ./
RUN pip install --requirement requirements.txt


FROM python:3.13.7-slim-bookworm AS runtime

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEB_DIST_PATH=/app/web-dist \
    MIGRATIONS_PATH=/app/migrations

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=python-builder /opt/venv /opt/venv
COPY --chown=app:app src/ ./src/
COPY --chown=app:app migrations/ ./migrations/
COPY --from=web-builder --chown=app:app /build/web/dist/ ./web-dist/

USER 10001:10001

EXPOSE 8000

CMD ["uvicorn", "text_yourself.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

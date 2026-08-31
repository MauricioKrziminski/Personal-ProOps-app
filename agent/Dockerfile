# Imagem única: FastAPI serve o webhook, o worker e os crons.
# Um container só mantém a portabilidade prometida — o mesmo build roda no Cloud
# Run hoje e num VPS com docker compose amanhã, sem tocar em lógica.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Cloud Run injeta $PORT; 8080 é o default local.
ENV PORT=8080
EXPOSE 8080

# Um worker de processo, concorrência por asyncio. O trabalho é I/O (Postgres,
# Gemini, Graph API) — mais processos só multiplicariam conexão de banco.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1

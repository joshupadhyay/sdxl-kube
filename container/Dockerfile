FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

COPY pyproject.toml .
COPY uv.lock .
RUN uv sync --locked --no-dev

COPY pythonapi.py .

EXPOSE 8080

CMD ["uv", "run", "--no-dev", "uvicorn", "pythonapi:app", "--host", "0.0.0.0", "--port", "8080"]

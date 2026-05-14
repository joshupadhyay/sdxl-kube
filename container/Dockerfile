FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

COPY pyproject.toml .
COPY uv.lock .
RUN uv sync --locked --no-dev

COPY pythonapi.py .
RUN chown -R app:app /app

USER app

EXPOSE 8080

CMD ["uv", "run", "--no-dev", "uvicorn", "pythonapi:app", "--host", "0.0.0.0", "--port", "8080"]

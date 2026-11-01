FROM python:3.12-slim

WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY backend/app /app/app
COPY supabase/migrations /app/migrations
ENV MIGRATIONS_DIR=/app/migrations
EXPOSE 8000
CMD ["sh", "-c", "python -m app.migrate && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

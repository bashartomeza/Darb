# Internal AI service (never exposed publicly; only the Node API calls it).
# Build context: apps/api   ->   docker build -t darb-ai-services -f ai_services/Dockerfile .
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /srv
COPY ai_services/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir "pydantic>=2.0"
COPY ai_services /srv/ai_services
RUN useradd --system --uid 10001 appuser && chown -R appuser /srv
USER appuser
ENV AI_SERVICES_HOST=0.0.0.0 AI_SERVICES_PORT=8765
EXPOSE 8765
HEALTHCHECK CMD python -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8765/health', timeout=3)"
CMD ["python", "-m", "ai_services.api.index"]

FROM python:3.12-slim

ENV TZ=Europe/Berlin

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg tzdata fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for better caching
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .

EXPOSE 5000

CMD ["python", "image_server.py"]

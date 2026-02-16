FROM python:3.11-slim

# 한국어 폰트 설치 (채점 이미지용)
RUN apt-get update && apt-get install -y \
    fonts-noto-cjk \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

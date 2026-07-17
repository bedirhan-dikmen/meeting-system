
FROM python:3.12-slim

# Python'un çıktıları tamponlamadan doğrudan konsola yazdırmasını sağlıyoruz (Loglama için kritik)
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Çalışma dizinini belirliyoruz
WORKDIR /workspace

# PostgreSQL bağlantısı ve derleme süreçleri için gerekli sistem bağımlılıklarını kuruyoruz
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Bağımlılık dosyasını kopyalayıp yüklüyoruz
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    apt-get purge -y --auto-remove gcc && \
    rm -rf /var/lib/apt/lists/*

# Tüm proje kodlarını kopyalıyoruz
COPY . .

# FastAPI'ın çalışacağı portu dış dünyaya açıyoruz
EXPOSE 8000

# Uygulamayı ayağa kaldıracak komut (Uvicorn)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
# app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Yebsoft Görüntülü ve Sesli Toplantı Yönetim Sistemi"
    API_V1_STR: str = "/api/v1"
    
    # Veritabanı Ayarları (Canlıda veya .env dosyasından ezilebilir)
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/yebsoft_db"
    
    # Güvenlik Ayarları
    SECRET_KEY: str = "SecretKey123!?"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 Gün

    model_config = SettingsConfigDict(
        env_file=".env",            # Proje kök dizinindeki .env dosyasını okur
        env_file_encoding="utf-8",
        case_sensitive=True,         # Büyük/küçük harf duyarlılığı (Örn: DATABASE_URL)
        extra="ignore"               # Fazladan çevre değişkeni tanımlanmışsa hata vermez, yoksayar
    )

settings = Settings()



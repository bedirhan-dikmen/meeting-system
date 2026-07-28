# app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    PROJECT_NAME: str = "Yebsoft Görüntülü ve Sesli Toplantı Yönetim Sistemi"
    API_V1_STR: str = "/api/v1"
    
    # Veritabanı Ayarları (Canlıda veya .env dosyasından ezilebilir)
    DATABASE_URL: str = "postgresql://yebsoft_user:YebsoftSecretPassword2026!@localhost:5432/meeting_system_prod"
    
    # Connection Pooling Ayarları (Canlı medya sinyalizasyonu için optimize edildi)
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 3600

    # Profil Resmi Upload Ayarları
    AVATAR_UPLOAD_DIR: str = "app/static/avatars"
    MAX_AVATAR_SIZE_MB: int = 5

    # Güvenlik Ayarları
    SECRET_KEY: str = "SecretKey123!?"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 Gün (1440 Dakika)

    model_config = SettingsConfigDict(
        env_file=".env",            # Proje kök dizinindeki .env dosyasını okur
        env_file_encoding="utf-8",
        case_sensitive=True,         # Büyük/küçük harf duyarlılığı (Örn: DATABASE_URL)
        extra="ignore"               # Fazladan çevre değişkeni tanımlanmışsa hata vermez, yoksayar
    )

settings = Settings()




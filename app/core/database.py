# app/core/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

# Veritabanı motorunu oluşturuyoruz. Echo=True ile konsolda SQL sorgularını görebiliriz (Geliştirme aşamasında faydalıdır).
engine = create_engine(
    settings.DATABASE_URL, 
    echo=True,
    pool_pre_ping=True  # Kopan veritabanı bağlantılarını otomatik tespit edip yeniler
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# API uçlarında veritabanı oturumunu asenkron/senkron güvenli şekilde enjekte etmek için dependency yapısı
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
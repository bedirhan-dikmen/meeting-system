# app/core/database.py
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.core.config import settings

db_url = settings.DATABASE_URL
connect_args = {}

# PostgreSQL bağlantısını dene, hata alırsa yerel SQLite veritabanına sorunsuz geç
try:
    if db_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        engine = create_engine(db_url, connect_args=connect_args, echo=False)
    else:
        engine = create_engine(
            db_url,
            pool_size=getattr(settings, "DB_POOL_SIZE", 20),
            max_overflow=getattr(settings, "DB_MAX_OVERFLOW", 10),
            pool_timeout=getattr(settings, "DB_POOL_TIMEOUT", 30),
            pool_recycle=getattr(settings, "DB_POOL_RECYCLE", 1800),
            pool_pre_ping=True,
            echo=False
        )
        # Test connection
        with engine.connect() as conn:
            pass
except Exception as e:
    logging.warning(f"PostgreSQL bağlantı hatası ({e}). Yerel SQLite veritabanına (meeting_system.db) geçiliyor.")
    db_url = "sqlite:///./meeting_system.db"
    connect_args = {"check_same_thread": False}
    engine = create_engine(db_url, connect_args=connect_args, echo=False)


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

# API uçlarında veritabanı oturumunu asenkron/senkron güvenli şekilde enjekte etmek için dependency yapısı
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
# alembic/env.py
from logging.config import fileConfig
import sys
import os

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from alembic import context

# Proje kök dizinini Python yoluna (sys.path) ekliyoruz ki importlar sorunsuz çalışsın
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # .env ayarlarımızı çekiyoruz
from app.core.database import Base    # Ortak veritabanı Base sınıfımız

# CRITICAL ENTEGRASYON: 
# app/models/__init__.py indeksleyicisini çalıştırarak tüm bölünmüş 
# modelleri (User, Meeting, Department vb.) Alembic'in görebilmesi için zorla RAM'e yüklüyoruz.
import app.models  

# access to the values within the .ini file in use.
config = context.config

# app/core/database veya docker-compose'dan gelen dinamik DATABASE_URL'i Alembic'e tanıtıyoruz
if os.getenv("DATABASE_URL"):
    config.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL"))

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Autogenerate desteği için metadata nesnemizi bağlıyoruz
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    from app.core.database import engine

    with engine.connect() as connection:
        context.configure(
            connection=connection, 
            target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()



if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
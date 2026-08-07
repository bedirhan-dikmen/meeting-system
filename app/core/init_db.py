import logging
from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import get_password_hash

logger = logging.getLogger(__name__)

from sqlalchemy import text, inspect


def auto_migrate_missing_columns(db: Session) -> None:
    """Modellerde tanımlı olup fiziksel tabloda henüz bulunmayan sütunları otomatik ekler.

    SQLite VE PostgreSQL için ortak (dialect-agnostic) çalışır.

    NEDEN GEREKLİ: Bu projede şemayı fiilen yöneten mekanizma
    `Base.metadata.create_all()` — bu sadece EKSİK TABLOLARI oluşturur, var olan
    bir tabloya sonradan modele eklenen sütunları asla eklemez. `alembic/` altında
    migration dosyaları var ama hiçbir yerde (dockerfile, nginx-entrypoint.sh,
    docker-compose.yml) fiilen `alembic upgrade head` çalıştırılmıyor. Sonuç:
    kalıcı bir Postgres/SQLite volume'u modele eklenen yeni sütunlar konusunda
    kalıcı olarak eski şemada takılı kalabiliyor.

    Canlıda tam olarak bu yaşandı: `meeting_notes.note_type` ve
    `notifications.meeting_code` sütunları production Postgres'te fiziksel
    olarak hiç yoktu; bu da `/meetings/{code}` ve `/notifications` uçlarının
    500 ile çökmesine ve `create_new_meeting`'in davet/bildirim insert'lerinin
    sessizce rollback olmasına (davetli kullanıcının katılımcı kaydı hiç
    oluşmamasına) sebep oluyordu.
    """
    try:
        from app.core.database import Base

        inspector = inspect(db.bind)
        existing_tables = set(inspector.get_table_names())
        dialect_name = db.bind.dialect.name

        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # Tablo hiç yoksa create_all() zaten oluşturacak

            try:
                existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
            except Exception as e:
                print(f"[AUTO MIGRATE] '{table.name}' sütunları okunamadı: {e}")
                continue

            for col in table.columns:
                if col.name in existing_cols:
                    continue

                try:
                    col_type_sql = col.type.compile(dialect=db.bind.dialect)
                except Exception:
                    print(f"[AUTO MIGRATE] '{table.name}.{col.name}' tipi bu dialect için derlenemedi, atlanıyor.")
                    continue

                default_sql = ""
                default_val = getattr(getattr(col, "default", None), "arg", None)
                if default_val is not None and not callable(default_val):
                    if isinstance(default_val, bool):
                        default_sql = f" DEFAULT {'TRUE' if default_val else 'FALSE'}"
                    elif isinstance(default_val, (int, float)):
                        default_sql = f" DEFAULT {default_val}"
                    elif isinstance(default_val, str):
                        default_sql = f" DEFAULT '{default_val.replace(chr(39), chr(39) * 2)}'"

                # NOT: Var olan satırları kırmamak için burada NOT NULL kısıtı
                # uygulanmıyor; yeni sütun nullable eklenir, uygulama/ORM katmanı
                # yeni kayıtlar için değeri zaten sağlıyor.
                try:
                    ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type_sql}{default_sql}'
                    db.execute(text(ddl))
                    db.commit()
                    print(f"[AUTO MIGRATE] {table.name}.{col.name} sütunu eklendi ({dialect_name}).")
                except Exception as e:
                    db.rollback()
                    print(f"[AUTO MIGRATE ERROR] {table.name}.{col.name}: {e}")
    except Exception as e:
        db.rollback()
        print(f"[AUTO MIGRATE ERROR] Genel hata: {e}")


def init_db(db: Session) -> None:
    """Şema senkronizasyonunu (eksik sütunlar) her zaman, demo kullanıcı
    tohumlamasını ise SADECE settings.SEED_DEMO_DATA açıksa çalıştırır.

    V1 TESLİM FIX: seed_hierarchy() eskiden koşulsuz her başlangıçta 20 sahte
    demo kullanıcı oluşturuyordu — bu kod tabanını devralıp kendi gerçek
    kullanıcılarını bağlayacak bir kurulumda istenmeyen bir yan etki.
    """
    try:
        auto_migrate_missing_columns(db)
    except Exception as e:
        print(f"[INIT DB] Şema senkronizasyon hatası: {e}")
        db.rollback()

    from app.core.config import settings
    if not settings.SEED_DEMO_DATA:
        print("[INIT DB] SEED_DEMO_DATA=false — demo/hiyerarşi tohumlaması atlandı.")
        return

    try:
        from seed_hierarchy import seed_hierarchy
        seed_hierarchy()
    except Exception as e:
        print(f"[INIT DB] Tohumlama hatası: {e}")
        db.rollback()

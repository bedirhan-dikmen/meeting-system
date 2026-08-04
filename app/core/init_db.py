import logging
from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import get_password_hash

logger = logging.getLogger(__name__)

from sqlalchemy import text

def check_and_migrate_sqlite(db: Session) -> None:
    """SQLite veritabanı tablolarına eksik sütunları otomatik ekler.

    NOT: Base.metadata.create_all() sadece eksik TABLOLARI oluşturur, var olan
    bir tabloya sonradan modele eklenen sütunları eklemez. Bu yüzden model
    değişikliklerinde burada elle bir kontrol/ALTER eklemek gerekiyor.
    """
    if db.bind and db.bind.dialect.name == "sqlite":
        try:
            cursor = db.execute(text("PRAGMA table_info(notifications)"))
            cols = [row[1] for row in cursor.fetchall()]
            if "meeting_code" not in cols:
                db.execute(text("ALTER TABLE notifications ADD COLUMN meeting_code VARCHAR"))
                db.commit()
                print("[INIT DB] SQLite notifications tablosuna 'meeting_code' sütunu eklendi.")
        except Exception as e:
            db.rollback()
            print(f"[INIT DB MIGRATION ERROR] {e}")

        try:
            cursor = db.execute(text("PRAGMA table_info(meeting_notes)"))
            cols = [row[1] for row in cursor.fetchall()]
            if cols and "note_type" not in cols:
                db.execute(text("ALTER TABLE meeting_notes ADD COLUMN note_type VARCHAR(20) NOT NULL DEFAULT 'general'"))
                db.commit()
                print("[INIT DB] SQLite meeting_notes tablosuna 'note_type' sütunu eklendi.")
        except Exception as e:
            db.rollback()
            print(f"[INIT DB MIGRATION ERROR] {e}")

def init_db(db: Session) -> None:
    """Veritabanı başlangıç kullanıcılarını ve hiyerarşiyi otomatik tohumlar."""
    try:
        check_and_migrate_sqlite(db)
        from seed_hierarchy import seed_hierarchy
        seed_hierarchy()
    except Exception as e:
        print(f"[INIT DB] Tohumlama hatası: {e}")
        db.rollback()

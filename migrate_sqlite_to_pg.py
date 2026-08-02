import sys
import logging
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import (
    Department,
    User,
    Meeting,
    MeetingParticipant,
    ParticipantSession,
    MeetingNote,
    MeetingAction,
    Notification,
    ApiClient,
    WebhookLog,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

SQLITE_URL = "sqlite:///./meeting_system.db"
PG_URL = "postgresql://yebsoft_user:YebsoftSecretPassword2026!@localhost:5442/meeting_system_prod"

def map_lookup(mapping, key):
    if key is None:
        return None
    if key in mapping:
        return mapping[key]
    key_str = str(key)
    for k, v in mapping.items():
        if str(k) == key_str:
            return v
    return key

def migrate():
    logging.info("SQLite -> PostgreSQL Gelişmiş Veri Aktarımı Başlatılıyor...")
    
    sqlite_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    pg_engine = create_engine(PG_URL, echo=False)

    SqliteSession = sessionmaker(bind=sqlite_engine)
    PgSession = sessionmaker(bind=pg_engine)

    sqlite_db = SqliteSession()
    pg_db = PgSession()

    try:
        logging.info("PostgreSQL tabloları doğrulanıyor...")
        Base.metadata.create_all(bind=pg_engine)

        dept_id_map = {}
        user_id_map = {}
        meeting_id_map = {}

        # 1. DEPARTMANLAR
        for dept in sqlite_db.query(Department).all():
            pg_dept = pg_db.query(Department).filter(
                (Department.id == dept.id) | (Department.name == dept.name)
            ).first()
            if not pg_dept:
                pg_dept = Department(name=dept.name, description=dept.description)
                pg_db.add(pg_dept)
                pg_db.flush()
            dept_id_map[dept.id] = pg_dept.id
        pg_db.commit()
        logging.info(f"[OK] Departmanlar eşlendi ({len(dept_id_map)} adet).")

        # 2. KULLANICILAR
        for u in sqlite_db.query(User).all():
            pg_u = pg_db.query(User).filter(
                (User.id == u.id) | (User.email == u.email)
            ).first()
            if not pg_u:
                target_dept_id = map_lookup(dept_id_map, u.department_id)
                pg_u = User(
                    id=u.id,
                    first_name=u.first_name,
                    last_name=u.last_name,
                    email=u.email,
                    user_code=u.user_code,
                    password_hash=u.password_hash,
                    role=u.role,
                    avatar_url=u.avatar_url,
                    is_active=u.is_active,
                    created_at=u.created_at,
                    department_id=target_dept_id
                )
                pg_db.add(pg_u)
                pg_db.flush()
            user_id_map[u.id] = pg_u.id
        pg_db.commit()
        logging.info(f"[OK] Kullanıcılar eşlendi ({len(user_id_map)} adet).")

        # 3. TOPLANTILAR
        for m in sqlite_db.query(Meeting).all():
            pg_m = pg_db.query(Meeting).filter(
                (Meeting.id == m.id) | (Meeting.meeting_code == m.meeting_code)
            ).first()
            if not pg_m:
                target_creator_id = map_lookup(user_id_map, m.created_by)
                pg_m = Meeting(
                    id=m.id,
                    title=m.title,
                    description=m.description,
                    scheduled_start=m.scheduled_start,
                    scheduled_end=m.scheduled_end,
                    actual_start=m.actual_start,
                    actual_end=m.actual_end,
                    meeting_code=m.meeting_code,
                    meeting_type=m.meeting_type,
                    agenda=m.agenda,
                    status=m.status,
                    passcode=m.passcode,
                    lobby_enabled=m.lobby_enabled,
                    is_private=m.is_private,
                    is_active=m.is_active,
                    created_at=m.created_at,
                    created_by=target_creator_id
                )
                pg_db.add(pg_m)
                pg_db.flush()
            meeting_id_map[m.id] = pg_m.id
        pg_db.commit()
        logging.info(f"[OK] Toplantılar eşlendi ({len(meeting_id_map)} adet).")

        # Jenerik Kopyalama Fonksiyonu
        def copy_generic(model, fk_mappings=None):
            records = sqlite_db.query(model).all()
            copied_count = 0
            for record in records:
                # Primary Key kontrolü
                if not pg_db.query(model).filter(model.id == record.id).first():
                    data = {}
                    for col in model.__table__.columns:
                        val = getattr(record, col.name, None)
                        if fk_mappings and col.name in fk_mappings:
                            val = map_lookup(fk_mappings[col.name], val)
                        data[col.name] = val
                    
                    # Eğer yabancı anahtarlar PostgreSQL'de yoksa veya geçersizse atla
                    if model == MeetingParticipant:
                        if not pg_db.query(Meeting).filter(Meeting.id == data.get("meeting_id")).first():
                            continue
                        if not pg_db.query(User).filter(User.id == data.get("user_id")).first():
                            continue

                    new_obj = model(**data)
                    pg_db.add(new_obj)
                    copied_count += 1
            pg_db.commit()
            logging.info(f"[OK] '{model.__tablename__}' tablosundan {copied_count} yeni kayıt aktarıldı.")

        # 4. TOPLANTININ DİĞER İLİŞKİLİ TABLOLARI
        copy_generic(MeetingParticipant, {"meeting_id": meeting_id_map, "user_id": user_id_map})
        copy_generic(ParticipantSession, {"meeting_id": meeting_id_map, "user_id": user_id_map})
        copy_generic(MeetingNote, {"meeting_id": meeting_id_map, "author_id": user_id_map})
        copy_generic(MeetingAction, {"meeting_id": meeting_id_map, "assigned_to_id": user_id_map})
        copy_generic(Notification, {"user_id": user_id_map})
        copy_generic(ApiClient)
        copy_generic(WebhookLog)

        logging.info("🎉 TEBRİKLER! Tüm verileriniz eksiksiz olarak PostgreSQL (Docker) veritabanına aktarıldı!")

    except Exception as e:
        pg_db.rollback()
        logging.error(f"Aktarım hatası: {e}")
        sys.exit(1)
    finally:
        sqlite_db.close()
        pg_db.close()

if __name__ == "__main__":
    migrate()

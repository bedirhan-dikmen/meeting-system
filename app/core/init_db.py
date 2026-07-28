import logging
from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import get_password_hash

logger = logging.getLogger(__name__)

def init_db(db: Session) -> None:
    """Veritabanı boşsa varsayılan yönetici ve örnek kullanıcıları otomatik oluşturur."""
    try:
        # Admin kullanıcısı kontrolü
        admin_user = db.query(User).filter(User.email == "admin@yebsoft.net").first()
        if not admin_user:
            admin_user = User(
                email="admin@yebsoft.net",
                user_code="ADM001",
                first_name="Yebsoft",
                last_name="Yönetici",
                role="admin",
                is_active=True,
                password_hash=get_password_hash("AdminPassword123!")
            )
            db.add(admin_user)
            print("[INIT DB] Admin kullanıcısı oluşturuldu: admin@yebsoft.net / AdminPassword123!")

        # Standart Kullanıcı 1
        user1 = db.query(User).filter(User.email == "user@yebsoft.net").first()
        if not user1:
            user1 = User(
                email="user@yebsoft.net",
                user_code="USR001",
                first_name="Ahmet",
                last_name="Yılmaz",
                role="user",
                is_active=True,
                password_hash=get_password_hash("UserPassword123!")
            )
            db.add(user1)
            print("[INIT DB] Kullanıcı 1 oluşturuldu: user@yebsoft.net / UserPassword123!")

        # Standart Kullanıcı 2
        user2 = db.query(User).filter(User.email == "user2@yebsoft.net").first()
        if not user2:
            user2 = User(
                email="user2@yebsoft.net",
                user_code="USR002",
                first_name="Ayşe",
                last_name="Kaya",
                role="user",
                is_active=True,
                password_hash=get_password_hash("UserPassword123!")
            )
            db.add(user2)
            print("[INIT DB] Kullanıcı 2 oluşturuldu: user2@yebsoft.net / UserPassword123!")

        db.commit()
    except Exception as e:
        print(f"[INIT DB] Kullanıcı oluşturma hatası: {e}")
        db.rollback()

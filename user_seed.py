# user_seed.py
from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models import User

def seed_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing_user = db.query(User).filter(User.email == "user@yebsoft.net").first()
        if not existing_user:
            user = User(
                email="user@yebsoft.net",
                password_hash=get_password_hash("User123!"),
                first_name="Yebsoft",
                last_name="Calisan",
                role="user",
                is_active=True,
                user_code="YEB002"
            )
            db.add(user)
            db.commit()
            print("[+] Baslangic User kullanicisi veritabanina yazildi: user@yebsoft.net / User123!")
        else:
            print("[*] User kullanicisi veritabaninda zaten mevcut.")
    except Exception as e:
        print(f"[X] Hata Olustu: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_db()
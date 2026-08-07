# DURUM: KULLANILMIYOR / ARŞİV. seed_hierarchy.py'den önceki, sabit "1"
# şifreli birkaç demo kullanıcı ekleyen ilk deneme script'i. GÜVENSİZ (şifre
# hardcoded) — canlı hiçbir ortamda çalıştırmayın. Sadece referans için
# burada bırakıldı.
from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models import User

def seed_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        default_hash = get_password_hash("1")
        
        # User 1
        existing_user = db.query(User).filter(User.email == "user@yebsoft.net").first()
        if not existing_user:
            user = User(
                email="user@yebsoft.net",
                password_hash=default_hash,
                first_name="Yebsoft",
                last_name="Calisan",
                role="user",
                is_active=True,
                user_code="YEB002"
            )
            db.add(user)
            print("[+] Baslangic User kullanicisi eklendi: user@yebsoft.net / 1")
        else:
            existing_user.password_hash = default_hash
            print("[+] User kullanicisi sifresi '1' olarak guncellendi.")
        
        # User 2
        existing_user2 = db.query(User).filter(User.email == "user2@yebsoft.net").first()
        if not existing_user2:
            user2 = User(
                email="user2@yebsoft.net",
                password_hash=default_hash,
                first_name="Mehmet",
                last_name="Yilmaz",
                role="user",
                is_active=True,
                user_code="YEB003"
            )
            db.add(user2)
            print("[+] Ikinci User kullanicisi eklendi: user2@yebsoft.net / 1")
        else:
            existing_user2.password_hash = default_hash
            print("[+] Ikinci User kullanicisi sifresi '1' olarak guncellendi.")
            
        db.commit()
    except Exception as e:
        print(f"[X] Hata Olustu: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_db()
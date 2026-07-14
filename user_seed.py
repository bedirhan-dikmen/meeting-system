# seed.py
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.all_models import User

def seed_db():
    db = SessionLocal()
    try:
        # Veritabanında bu e-posta ile kayıtlı bir kullanıcı var mı kontrol et
        existing_user = db.query(User).filter(User.email == "user@yebsoft.net").first()
        if not existing_user:
            user = User(
                email="user@yebsoft.net",
                password_hash=get_password_hash("User123!"),  # Şifreyi bcrypt ile hash'liyoruz
                first_name="Yebsoft",
                last_name="Çalışan",
                role="user",
                is_active=True,
                user_code="YEB002"
            )
            db.add(user)
            db.commit()
            print("\n==================================================================")
            print(" BAŞARILI: Başlangıç User kullanıcısı veritabanına yazıldı!")
            print(" E-posta: user@yebsoft.net")
            print(" Şifre  : user123!")
            print("==================================================================\n")
        else:
            print("\n[!] Bilgi: User kullanıcısı veritabanında zaten mevcut.\n")
    except Exception as e:
        print(f"\n[X] Hata Oluştu: {e}\n")
    finally:
        db.close()

if __name__ == "__main__":
    seed_db()
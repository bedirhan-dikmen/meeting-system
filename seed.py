# seed.py
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.all_models import User

def seed_db():
    db = SessionLocal()
    try:
        # Veritabanında bu e-posta ile kayıtlı bir kullanıcı var mı kontrol et
        existing_user = db.query(User).filter(User.email == "admin@yebsoft.net").first()
        if not existing_user:
            admin_user = User(
                email="admin@yebsoft.net",
                password_hash=get_password_hash("Admin123!"),  # Şifreyi bcrypt ile hash'liyoruz
                first_name="Yebsoft",
                last_name="Yönetici",
                role="admin",
                is_active=True,
                user_code="YEB001"
            )
            db.add(admin_user)
            db.commit()
            print("\n==================================================================")
            print(" BAŞARILI: Başlangıç admin kullanıcısı veritabanına yazıldı!")
            print(" E-posta: admin@yebsoft.net")
            print(" Şifre  : Admin123!")
            print("==================================================================\n")
        else:
            print("\n[!] Bilgi: Admin kullanıcısı veritabanında zaten mevcut.\n")
    except Exception as e:
        print(f"\n[X] Hata Oluştu: {e}\n")
    finally:
        db.close()

if __name__ == "__main__":
    seed_db()
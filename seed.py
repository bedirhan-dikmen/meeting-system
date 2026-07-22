import sys
from sqlalchemy.orm import Session
from app.core.database import SessionLocal, engine, Base
from app.models import User, Department 
from app.core.security import get_password_hash

def seed_database():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        print("[*] Veritabani doldurma islem (seeding) baslatildi...")
        
        # 1. Önce "Yönetim" departmanını kontrol et veya oluştur
        dept = db.query(Department).filter(Department.name == "Yönetim").first()
        if not dept:
            dept = Department(
                name="Yönetim",
                description="Yebsoft Genel Yönetim ve Sistem Yönetici Kadrosu"
            )
            db.add(dept)
            db.commit()
            db.refresh(dept)
            print(f"[+] 'Yonetim' departmani basariyla eklendi. (Yeni ID: {dept.id})")
        else:
            print(f"[*] 'Yonetim' departmani zaten mevcut. (ID: {dept.id})")
        
        # 2. İlk Admin kullanıcısını kontrol et veya oluştur
        admin_email = "admin@yebsoft.net"
        admin_user = db.query(User).filter(User.email == admin_email).first()
        
        if not admin_user:
            hashed_pwd = get_password_hash("YEBsoft2026!")
            
            admin_user = User(
                first_name="Yebsoft",
                last_name="Yönetici",
                email=admin_email,
                user_code="YEB001",
                password_hash=hashed_pwd, 
                role="admin",
                is_active=True,
                department_id=dept.id
            )
            db.add(admin_user)
            db.commit()
            print(f"[+] Ilk sistem yoneticisi basariyla veritabanina eklendi: {admin_email} / YEBsoft2026!")
        else:
            print("[*] Sistem yoneticisi zaten mevcut, ekleme adimi atlandi.")
            
    except Exception as e:
        db.rollback()
        print(f"[X] Seed islemi sirasinda hata alindi: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
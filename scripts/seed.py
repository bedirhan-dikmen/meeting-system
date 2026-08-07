# DURUM: KULLANILMIYOR / ARŞİV. Uygulama artık başlangıçta seed_hierarchy.py'yi
# (proje kökünde, SEED_DEMO_DATA=true ise) çalıştırıyor. Bu dosya o mekanizma
# kurulmadan önceki, tek departman + birkaç kullanıcı ekleyen ilk seed script'i
# — repo geçmişini/referansını korumak için burada bırakıldı, çalıştırmanıza
# gerek yok. Kök dizinden `python scripts/seed.py` ile elle çalıştırılabilir.
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
        
        # 1. Departman
        dept = db.query(Department).filter(Department.name == "Yönetim").first()
        if not dept:
            dept = Department(
                name="Yönetim",
                description="Yebsoft Genel Yönetim ve Sistem Yönetici Kadrosu"
            )
            db.add(dept)
            db.commit()
            db.refresh(dept)
            print(f"[+] 'Yonetim' departmani eklendi. (ID: {dept.id})")
        
        # 2. Sistem Yöneticisi
        admin_email = "admin@yebsoft.net"
        admin_user = db.query(User).filter(User.email == admin_email).first()
        hashed_pwd = get_password_hash("1")
        
        if not admin_user:
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
            print(f"[+] Sistem yoneticisi eklendi: {admin_email} / 1")
        else:
            admin_user.password_hash = hashed_pwd
            db.commit()
            print(f"[+] Sistem yoneticisinin sifresi '1' olarak guncellendi.")
            
    except Exception as e:
        db.rollback()
        print(f"[X] Seed islemi sirasinda hata alindi: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()

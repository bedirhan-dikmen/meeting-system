import sys
import os
from sqlalchemy.orm import Session
from app.core.database import SessionLocal, engine, Base
from app.models import User, Department  # Tüm ilişkilerin kurulması için merkezi import
from app.core.security import get_password_hash

def seed_database():
    print("🌱 Veritabanı tabloları kontrol ediliyor ve seeding başlatılıyor...")
    
    # 0. Veritabanında henüz oluşmamış tablolar varsa otomatik kur
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    try:
        # 1. DEPARTMANLARI OLUŞTUR / KONTROL ET
        departments_data = [
            {"name": "Yönetim", "description": "Yebsoft Üst Yönetim ve İdari Kadro"},
            {"name": "Yazılım / Bilişim", "description": "Yazılım Geliştirme ve Sistem Mühendisliği"},
            {"name": "İnsan Kaynakları", "description": "İnsan Kaynakları ve Personel Yönetimi"}
        ]

        created_departments = {}
        for d_info in departments_data:
            dept = db.query(Department).filter(Department.name == d_info["name"]).first()
            if not dept:
                dept = Department(name=d_info["name"], description=d_info["description"])
                db.add(dept)
                db.commit()
                db.refresh(dept)
                print(f"✅ Departman eklendi: {dept.name} (ID: {dept.id})")
            else:
                print(f"ℹ️ Departman zaten mevcut: {dept.name} (ID: {dept.id})")
            created_departments[d_info["name"]] = dept

        default_dept = created_departments.get("Yönetim")
        dev_dept = created_departments.get("Yazılım / Bilişim")

        # 2. İLK SİSTEM YÖNETİCİSİ (ADMIN) OLUŞTUR
        admin_email = "admin@yebsoft.net"
        admin_user = db.query(User).filter(User.email == admin_email).first()
        
        if not admin_user:
            admin_user = User(
                first_name="Yebsoft",
                last_name="Yönetici",
                email=admin_email,
                user_code="YEB001",
                password_hash=get_password_hash("YEBsoft2026!"), 
                role="admin",
                is_active=True,
                avatar_url=None,
                department_id=default_dept.id if default_dept else None
            )
            db.add(admin_user)
            db.commit()
            print(f"🎉 Yönetici Hesabı Oluşturuldu -> E-posta: {admin_email} | Şifre: YEBsoft2026! | Kod: YEB001")
        else:
            print(f"ℹ️ Yönetici hesabı zaten mevcut: {admin_email}")

        # 3. ÖRNEK TEST KULLANICISI (USER) OLUŞTUR
        test_user_email = "user@yebsoft.net"
        test_user = db.query(User).filter(User.email == test_user_email).first()

        if not test_user:
            test_user = User(
                first_name="Ahmet",
                last_name="Yılmaz",
                email=test_user_email,
                user_code="YEB002",
                password_hash=get_password_hash("YEBsoft2026!"), 
                role="user",
                is_active=True,
                avatar_url=None,
                department_id=dev_dept.id if dev_dept else None
            )
            db.add(test_user)
            db.commit()
            print(f"🎉 Test Kullanıcısı Oluşturuldu -> E-posta: {test_user_email} | Şifre: YEBsoft2026! | Kod: YEB002")
        else:
            print(f"ℹ️ Test kullanıcısı zaten mevcut: {test_user_email}")

        print("\n🚀 Veritabanı doldurma (Seeding) başarıyla tamamlandı!")

    except Exception as e:
        db.rollback()
        print(f"❌ Seeding esnasında hata oluştu: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_database()
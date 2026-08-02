import sys
import os
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models.department import Department
from app.models.user import User

def seed_hierarchy():
    print("==================================================")
    print("   SEEDING HIERARCHICAL DATABASE (20 USERS)       ")
    print("==================================================")
    
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    try:
        default_hash = get_password_hash("1")

        # 1. DEPARTMANLARI OLUŞTUR / GÜNCELLE
        departments_data = [
            {"name": "Yönetim Kurulu & Genel Merkez", "description": "Şirket Üst Yönetimi ve İdari Birimler"},
            {"name": "Yazılım & Teknoloji", "description": "Yazılım, WebRTC ve Sistem Geliştirme Departmanı"},
            {"name": "İnsan Kaynakları", "description": "İşe Alım, Personel ve Organizasyonel Gelişim"},
            {"name": "Pazarlama & Dijital Satış", "description": "Dijital Pazarlama, Grafik ve Satış Operasyonları"},
            {"name": "Finans & Muhasebe", "description": "Mali İşler, Bütçe ve Finansal Raporlama"}
        ]

        dept_map = {}
        for d_info in departments_data:
            dept = db.query(Department).filter(Department.name == d_info["name"]).first()
            if not dept:
                dept = Department(name=d_info["name"], description=d_info["description"])
                db.add(dept)
                db.flush()
                print(f"[+] Departman Oluşturuldu: {dept.name} (ID: {dept.id})")
            dept_map[d_info["name"]] = dept.id

        db.commit()

        # 2. 20 KULLANICI LİSTESİ (5 YÖNETİCİ + 15 ÇALIŞAN)
        users_data = [
            # --- 5 YÖNETİCİ (ADMIN / MANAGER) ---
            {
                "email": "admin@yebsoft.net",
                "user_code": "ADM001",
                "first_name": "Yebsoft",
                "last_name": "Genel Yönetici",
                "role": "admin",
                "dept": "Yönetim Kurulu & Genel Merkez"
            },
            {
                "email": "yazilim.muduru@yebsoft.net",
                "user_code": "MNG001",
                "first_name": "Ahmet",
                "last_name": "Yılmaz",
                "role": "manager",
                "dept": "Yazılım & Teknoloji"
            },
            {
                "email": "ik.muduru@yebsoft.net",
                "user_code": "MNG002",
                "first_name": "Elif",
                "last_name": "Demir",
                "role": "manager",
                "dept": "İnsan Kaynakları"
            },
            {
                "email": "pazarlama.muduru@yebsoft.net",
                "user_code": "MNG003",
                "first_name": "Caner",
                "last_name": "Kaya",
                "role": "manager",
                "dept": "Pazarlama & Dijital Satış"
            },
            {
                "email": "finans.muduru@yebsoft.net",
                "user_code": "MNG004",
                "first_name": "Zeynep",
                "last_name": "Şahin",
                "role": "manager",
                "dept": "Finans & Muhasebe"
            },

            # --- 15 ÇALIŞAN (USER) ---
            # Yazılım & Teknoloji (4 kişi)
            {
                "email": "mehmet.aydin@yebsoft.net",
                "user_code": "USR001",
                "first_name": "Mehmet",
                "last_name": "Aydın",
                "role": "user",
                "dept": "Yazılım & Teknoloji"
            },
            {
                "email": "ayse.arslan@yebsoft.net",
                "user_code": "USR002",
                "first_name": "Ayşe",
                "last_name": "Arslan",
                "role": "user",
                "dept": "Yazılım & Teknoloji"
            },
            {
                "email": "burak.celik@yebsoft.net",
                "user_code": "USR003",
                "first_name": "Burak",
                "last_name": "Çelik",
                "role": "user",
                "dept": "Yazılım & Teknoloji"
            },
            {
                "email": "selin.yildiz@yebsoft.net",
                "user_code": "USR004",
                "first_name": "Selin",
                "last_name": "Yıldız",
                "role": "user",
                "dept": "Yazılım & Teknoloji"
            },

            # İnsan Kaynakları (3 kişi)
            {
                "email": "emre.ozturk@yebsoft.net",
                "user_code": "USR005",
                "first_name": "Emre",
                "last_name": "Öztürk",
                "role": "user",
                "dept": "İnsan Kaynakları"
            },
            {
                "email": "gozde.yilmaz@yebsoft.net",
                "user_code": "USR006",
                "first_name": "Gözde",
                "last_name": "Yılmaz",
                "role": "user",
                "dept": "İnsan Kaynakları"
            },
            {
                "email": "deniz.kaan@yebsoft.net",
                "user_code": "USR007",
                "first_name": "Deniz",
                "last_name": "Kaan",
                "role": "user",
                "dept": "İnsan Kaynakları"
            },

            # Pazarlama & Dijital Satış (4 kişi)
            {
                "email": "murat.aksoy@yebsoft.net",
                "user_code": "USR008",
                "first_name": "Murat",
                "last_name": "Aksoy",
                "role": "user",
                "dept": "Pazarlama & Dijital Satış"
            },
            {
                "email": "busra.tekin@yebsoft.net",
                "user_code": "USR009",
                "first_name": "Büşra",
                "last_name": "Tekin",
                "role": "user",
                "dept": "Pazarlama & Dijital Satış"
            },
            {
                "email": "hakan.erdem@yebsoft.net",
                "user_code": "USR010",
                "first_name": "Hakan",
                "last_name": "Erdem",
                "role": "user",
                "dept": "Pazarlama & Dijital Satış"
            },
            {
                "email": "ceren.kurt@yebsoft.net",
                "user_code": "USR011",
                "first_name": "Ceren",
                "last_name": "Kurt",
                "role": "user",
                "dept": "Pazarlama & Dijital Satış"
            },

            # Finans & Muhasebe (4 kişi)
            {
                "email": "oguz.kilic@yebsoft.net",
                "user_code": "USR012",
                "first_name": "Oğuz",
                "last_name": "Kılıç",
                "role": "user",
                "dept": "Finans & Muhasebe"
            },
            {
                "email": "tugba.polat@yebsoft.net",
                "user_code": "USR013",
                "first_name": "Tuğba",
                "last_name": "Polat",
                "role": "user",
                "dept": "Finans & Muhasebe"
            },
            {
                "email": "kaan.erdogan@yebsoft.net",
                "user_code": "USR014",
                "first_name": "Kaan",
                "last_name": "Erdoğan",
                "role": "user",
                "dept": "Finans & Muhasebe"
            },
            {
                "email": "merve.cakir@yebsoft.net",
                "user_code": "USR015",
                "first_name": "Merve",
                "last_name": "Çakır",
                "role": "user",
                "dept": "Finans & Muhasebe"
            }
        ]

        added_count = 0
        updated_count = 0

        for u_info in users_data:
            existing = db.query(User).filter(User.email == u_info["email"]).first()
            dept_id = dept_map.get(u_info["dept"])

            if not existing:
                new_user = User(
                    email=u_info["email"],
                    user_code=u_info["user_code"],
                    first_name=u_info["first_name"],
                    last_name=u_info["last_name"],
                    role=u_info["role"],
                    department_id=dept_id,
                    password_hash=default_hash,
                    is_active=True
                )
                db.add(new_user)
                added_count += 1
            else:
                existing.first_name = u_info["first_name"]
                existing.last_name = u_info["last_name"]
                existing.role = u_info["role"]
                existing.department_id = dept_id
                existing.password_hash = default_hash
                updated_count += 1

        db.commit()
        print(f"\n[+] BAŞARILI: {added_count} Yeni Kullanıcı Eklendi, {updated_count} Kullanıcı Güncellendi.")
        print(f"[+] Tüm Kullanıcılar İçin Geçerli Giriş Şifresi: '1'")
        print("==================================================")

    except Exception as e:
        print(f"[X] Tohumlama Hatası: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_hierarchy()

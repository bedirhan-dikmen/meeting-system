"""
İlk kurulum bootstrap aracı: sistemde HİÇ kullanıcı yokken (SEED_DEMO_DATA=false
ile taze bir veritabanında normal durum budur) giriş yapabileceğiniz ilk admin
hesabını oluşturur.

NEDEN GEREKLİ: `POST /api/v1/users/` (yeni kullanıcı ekleme) uç noktası zaten
giriş yapmış bir admin gerektiriyor (bkz. app/routes/users.py) ve genel/public
bir kayıt (self sign-up) ekranı yok — yani taze bir veritabanında admin
oluşturmanın tek yolu bu script (ya da .env'de SEED_DEMO_DATA=true yapıp demo
verisini kullanmak, ki bu gerçek bir kurulum için önerilmez).

KULLANIM:
    Docker Compose ile:
        docker compose exec web python scripts/create_admin.py \\
            --email admin@sirketiniz.com --password GucluBirSifre123! \\
            --first-name Ad --last-name Soyad

    Docker'sız (yerel .env'iniz varken):
        python scripts/create_admin.py --email ... --password ...

E-posta zaten kayıtlıysa script o kullanıcıyı günceller (rolünü admin yapar,
şifreyi değiştirmez) — birden fazla kez çalıştırmak güvenlidir.
"""
import argparse
import os
import sys

# scripts/ kendi dizinini sys.path[0] yapıyor, "app" paketi ise bir üst
# (proje kökü) dizinde — CWD'den bağımsız çalışsın diye kökü kendimiz ekliyoruz.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import SessionLocal
from app.models.user import User
from app.core.security import get_password_hash


def main():
    parser = argparse.ArgumentParser(description="İlk admin hesabını oluşturur/yükseltir.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True, help="En az 6 karakter.")
    parser.add_argument("--first-name", default="Sistem")
    parser.add_argument("--last-name", default="Yöneticisi")
    parser.add_argument("--user-code", default="ADMIN001")
    args = parser.parse_args()

    if len(args.password) < 6:
        print("HATA: Şifre en az 6 karakter olmalı.")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == args.email).first()
        if existing:
            existing.role = "admin"
            existing.is_active = True
            db.commit()
            print(f"[OK] '{args.email}' zaten kayıtlıydı — rolü 'admin' olarak güncellendi.")
            return

        user = User(
            first_name=args.first_name,
            last_name=args.last_name,
            email=args.email,
            user_code=args.user_code,
            password_hash=get_password_hash(args.password),
            role="admin",
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"[OK] Admin hesabı oluşturuldu: {args.email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()

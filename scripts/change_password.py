# DURUM: Manuel yönetici aracı, hâlâ kullanışlı (bir kullanıcının şifresini
# API/UI olmadan doğrudan DB'de sıfırlamak için). DİKKAT: PG_URL aşağıda bu
# geliştirme makinesine özel bağlantı bilgileriyle sabit kodlanmış — başka bir
# ortamda kullanmadan önce mutlaka kendi DATABASE_URL'inizle güncelleyin
# (bkz. .env / docker-compose.yml'deki POSTGRES_* değerleri).
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.user import User
from app.core.security import get_password_hash

PG_URL = "postgresql://yebsoft_user:YebsoftSecretPassword2026!@localhost:5442/meeting_system_prod"
SQLITE_URL = "sqlite:///./meeting_system.db"

def change_password(email: str, new_password: str):
    hashed_pwd = get_password_hash(new_password)
    print(f"[*] '{email}' kullanıcısının şifresi '{new_password}' olarak sıfırlanıyor...")

    # 1. PostgreSQL Veritabanında Güncelle
    try:
        pg_engine = create_engine(PG_URL, echo=False)
        PgSession = sessionmaker(bind=pg_engine)
        pg_db = PgSession()

        user_pg = pg_db.query(User).filter(User.email == email).first()
        if user_pg:
            user_pg.password_hash = hashed_pwd
            pg_db.commit()
            print(f"[+] PostgreSQL: '{email}' şifresi başarıyla güncellendi.")
        else:
            print(f"[!] PostgreSQL: '{email}' kullanıcısı bulunamadı.")
        pg_db.close()
    except Exception as e:
        print(f"[X] PostgreSQL güncelleme hatası: {e}")

    # 2. SQLite Veritabanında Güncelle
    try:
        sqlite_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
        SqliteSession = sessionmaker(bind=sqlite_engine)
        sqlite_db = SqliteSession()

        user_sqlite = sqlite_db.query(User).filter(User.email == email).first()
        if user_sqlite:
            user_sqlite.password_hash = hashed_pwd
            sqlite_db.commit()
            print(f"[+] SQLite: '{email}' şifresi başarıyla güncellendi.")
        else:
            print(f"[!] SQLite: '{email}' kullanıcısı bulunamadı.")
        sqlite_db.close()
    except Exception as e:
        print(f"[X] SQLite güncelleme hatası: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Kullanım: python change_password.py <email> <yeni_sifre>")
        print("Örnek  : python change_password.py admin@yebsoft.net 1")
        sys.exit(1)

    email_input = sys.argv[1]
    pwd_input = sys.argv[2]
    change_password(email_input, pwd_input)

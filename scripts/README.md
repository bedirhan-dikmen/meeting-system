# scripts/

Uygulamanın **çalışma zamanıyla ilgisi olmayan**, elle/tek seferlik çalıştırılan yardımcı araçlar. Kurulum/deploy için hiçbiri zorunlu değildir — uygulama açılışta tabloları kendisi oluşturur (bkz. kök dizindeki `README.md`).

| Dosya | Ne işe yarar | Hâlâ gerekli mi? |
|---|---|---|
| `create_admin.py` | **İlk kurulumda** giriş yapabileceğiniz ilk admin hesabını oluşturur (`SEED_DEMO_DATA=false` iken veritabanı boş başlar, bu script olmadan sisteme hiç giriş yapılamaz). | **Evet — kendi sunucunuzda ilk kurulumda mutlaka bir kez çalıştırın.** Ana `README.md`'ye bakın. |
| `change_password.py` | Bir kullanıcının şifresini API/UI olmadan doğrudan DB'de sıfırlar. | Evet, kullanışlı bir yönetici aracı — çalıştırmadan önce içindeki `PG_URL`'i kendi ortamınıza göre güncelleyin. |
| `migrate_sqlite_to_pg.py` | Eski bir SQLite veritabanını Postgres'e taşır. | Sadece taşınacak eski bir SQLite dosyanız varsa. |
| `seed.py`, `user_seed.py` | `seed_hierarchy.py`'den önceki ilk deneme seed script'leri. | Hayır — arşiv, çalıştırmayın (`user_seed.py` güvensiz sabit şifre içeriyor). |
| `generate_deck.py` | Sunum/tanıtım amaçlı bir PowerPoint dosyası üretir. | Uygulamayla ilgisi yok, isteğe bağlı. |

Asıl (uygulamanın kendisinin başlangıçta çağırdığı) seed mekanizması kök dizindeki **`seed_hierarchy.py`**'dir — `SEED_DEMO_DATA=true` olduğunda çalışır, bkz. `.env.example`.

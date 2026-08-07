# Kurumsal Görüntülü ve Sesli Toplantı Yönetim Sistemi

FastAPI + Jinja2/Vanilla JS + kendi WebRTC sinyalleşme katmanı ile geliştirilmiş, uçtan uca bir kurumsal toplantı platformu: planlı/anlık toplantılar, canlı görüntülü/sesli görüşme + ekran paylaşımı, misafir katılımı, toplantı notları/aksiyon kararları, resmi katılım raporları ve yönetici arşivi.

> **v1 — ilk teslim sürümü.** Bu sürüm etiketi: `v1.0.0`.

---

## Mimari ve Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| Backend | FastAPI (Python), SQLAlchemy ORM, Pydantic Settings |
| Veritabanı | PostgreSQL (Docker Compose ile) — bağlantı kurulamazsa yerel SQLite'a otomatik düşer |
| Kimlik Doğrulama | JWT (kendi kullanıcı/parola tablosu, `localStorage` + cookie) |
| Görüntülü/Sesli Görüşme | Tarayıcı native WebRTC API'leri + kendi WebSocket sinyalleşme sunucusu (`app/routes/signaling.py`) + **coturn** (STUN/TURN, medya geçişi için) |
| Frontend | Sunucu taraflı Jinja2 şablonları + Vanilla JS/CSS (build adımı yok, framework yok) |
| Reverse Proxy / SSL | nginx (HTTP→HTTPS, kendinden imzalı sertifika otomatik üretir; gerçek sertifika için certbot volume'ları hazır) |

**Not:** Önceki bir sürümde LiveKit entegrasyonu planlanmıştı; mevcut kod tabanında kullanılmıyor (WebRTC sinyalleşmesi tamamen kendi altyapımızda). `requirements.txt`'te LiveKit bağımlılığı yok.

---

## Hızlı Başlangıç (Docker Compose — önerilen/gerçek deploy yolu)

```bash
# 1) Ortam dosyanızı oluşturun ve KENDİ değerlerinizle doldurun
cp .env.example .env
# .env içindeki DOMAIN, POSTGRES_*, SECRET_KEY, ALLOWED_ORIGINS değerlerini
# mutlaka kendi ortamınıza göre düzenleyin (aşağıdaki "Kendi Sunucunuzda
# Devreye Alma" bölümüne bakın).

# 2) Servisleri ayağa kaldırın (Postgres + API + coturn + nginx)
docker compose up -d --build

# 3) İlk admin hesabınızı oluşturun (veritabanı taze/boş başlar — bkz. aşağı)
docker compose exec web python scripts/create_admin.py \
  --email admin@sirketiniz.com --password GucluBirSifre123! \
  --first-name Ad --last-name Soyad
```

Tarayıcıda:
- Uygulama: `http://localhost:8090` (veya nginx'i 443'e bağladıysanız `https://DOMAIN`)
- API dokümantasyonu (Swagger): `http://localhost:8090/docs`

Servisler: `db` (Postgres), `web` (FastAPI, canlı reload açık), `coturn` (WebRTC medya geçişi), `nginx` (reverse proxy + SSL). CasaOS gibi bir panelden tanınabilmesi için `docker-compose.yml`'de bir `x-casaos:` bloğu da var (düz `docker compose` kullanımını etkilemez).

### Kod değişikliği yaptıktan sonra (statik dosyalar/şablonlar)

`web` servisi `--reload` ile çalıştığı ve `./app` klasörü canlı mount edildiği için Python değişiklikleri otomatik yansır. JS/CSS/HTML şablon değişiklikleri için de aynı mount sayesinde yeniden başlatmaya bile gerek yoktur; emin olmak isterseniz:

```bash
docker compose restart web
```

Dockerfile'ı değiştirdiyseniz veya `requirements.txt`'e bağımlılık eklediyseniz image'ı yeniden build edin: `docker compose up -d --build web`.

---

## Kendi Sunucunuzda Devreye Alma (proje müdürü / farklı bir ortam için)

Bu repo'yu klonlayıp **hiçbir kod dosyasını değiştirmeden**, sadece `.env` dosyanızı doldurarak kendi sunucunuza deploy edebilirsiniz:

1. `cp .env.example .env` — dosyanın içindeki her satırı (özellikle aşağıdakileri) kendi bilgilerinizle doldurun:
   - `DOMAIN` — kendi domain'iniz (yoksa `localhost` bırakabilirsiniz).
   - `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` — kendi veritabanı kimlik bilgileriniz.
   - `SECRET_KEY` — rastgele, güçlü, kimseyle paylaşmadığınız bir değer (`python -c "import secrets; print(secrets.token_urlsafe(48))"`).
   - `ALLOWED_ORIGINS` — sadece gerçek domain'iniz (asla `*` kullanmayın).
   - `SEED_DEMO_DATA` — **`false` bırakın** (varsayılan). `true` yaparsanız sistem 20 sahte demo kullanıcı ekler; gerçek kullanıcılarınızı bağlayacaksanız buna gerek yok.
2. `docker compose up -d --build`
3. İlk admin hesabınızı oluşturun (yukarıdaki komut) — bundan sonra diğer tüm kullanıcıları **uygulama içinden** (admin panelinden / `POST /api/v1/users/`) admin hesabınızla ekleyebilirsiniz. Genel/herkese açık bir "kayıt ol" ekranı yok — kullanıcılar bir admin tarafından eklenir.
4. WebRTC (görüntülü görüşme) için `coturn` konteynerinin TURN kimlik bilgisi (`TURN_USERNAME`/`TURN_CREDENTIAL`) ile `app/static/js/webrtc.js` içindeki `getIceServers()` fonksiyonunda sabit kodlanmış aynı iki değer **birebir eşleşmeli** (istemci tarafı statik JS dosyaları `.env`'i okuyamaz). Varsayılan değerleri değiştirmediyseniz bir şey yapmanıza gerek yok; değiştirdiyseniz o dosyadaki iki satırı da güncelleyin.
5. Gerçek bir SSL sertifikanız varsa `certbot_certs/` volume'üne yerleştirin (yoksa nginx kendinden imzalı bir sertifika üretip HTTPS'i yine çalıştırır, tarayıcı sadece uyarı gösterir).

### Şema/migration hakkında

Uygulama açılışta tabloları kendisi oluşturur (`Base.metadata.create_all`) ve modele sonradan eklenen sütunları da otomatik olarak mevcut tablolara ekler (`app/core/init_db.py` → `auto_migrate_missing_columns`) — **elle bir migration komutu çalıştırmanız gerekmez.** `alembic/` dizini erken dönemden kalma migration dosyaları içerir ama şu an deploy akışının bir parçası değildir (referans amaçlı arşiv).

---

## Proje Yapısı

```
app/
  core/       # Ayarlar (.env okuma), veritabanı bağlantısı, güvenlik/JWT, ilk kurulum
  models/     # SQLAlchemy modelleri
  schemas/    # Pydantic şemaları (istek/yanıt doğrulama)
  routes/     # API uç noktaları (/api/v1/...)
  services/   # İş mantığı katmanı
  templates/  # Jinja2 sayfaları (dashboard, toplantılar, oda, misafir girişi, rapor...)
  static/     # CSS/JS (framework yok, doğrudan tarayıcıya sunulur)
scripts/      # Uygulamanın çalışma zamanıyla ilgisi olmayan tek seferlik/yönetici araçları (bkz. scripts/README.md)
seed_hierarchy.py   # SEED_DEMO_DATA=true ise açılışta çalışan demo veri seed'i
docker-compose.yml  # db + web + coturn + nginx
nginx.conf.template  # DOMAIN'e göre açılışta işlenir (bkz. nginx-entrypoint.sh)
```

---

## Ana Özellikler

- Planlı / anlık toplantı oluşturma, düzenleme, iptal, kalıcı silme; günlük "Tamamlanan"/"İptal Edilenler" görünümleri
- Canlı toplantı odası: video ızgarası, mikrofon/kamera kontrolü, ekran paylaşımı (izleyiciye özel ses seviyesi kontrolü dahil), sohbet, katılımcı listesi, bekleme odası (lobi) onayı
- Misafir (hesapsız) katılım akışı — davet linki + oda anahtarı
- Toplantı içi not alma (genel karar + kişisel özel not) ve aksiyon kararı takibi
- Sona ermiş/iptal edilmiş bir toplantıya geri dönüp düzenleme yapılamaz (sunucu tarafında kilitli)
- Resmi katılım & tutanak raporu (yazdırma/PDF, kişisel notlar isteğe bağlı dahil edilir)
- Rol tabanlı yetkilendirme (admin/manager/host/kullanıcı), bildirim sistemi
- Tüm sayfalar mobil uyumlu (responsive)

---

## Geliştirme (Docker'sız, yerel)

```bash
pip install -r requirements.txt
# .env dosyanızda DATABASE_URL'in yerel bir Postgres'e (ya da SQLite fallback'e) işaret ettiğinden emin olun
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

---
*Kurumsal Toplantı Yönetim Sistemi*

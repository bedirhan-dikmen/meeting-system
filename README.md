# Yebsoft Kurumsal Görüntülü ve Sesli Toplantı Yönetim Sistemi 🚀

Bu proje; **Python (FastAPI)**, **SQLAlchemy**, **WebRTC / LiveKit**, **Chart.js** ve modern **Jinja2 + Vanilla JS/CSS** teknolojileri kullanılarak geliştirilmiş, uçtan uca modern bir kurumsal görüntülü ve sesli toplantı yönetim platformudur.

---

## 📌 Proje Genel Bakış ve Projenin Gelişim Süreci

Proje başlangıç seviyesindeki şablon yapısından alınıp; **gelişmiş kullanıcı arayüzü (UI/UX)**, **canlı WebRTC toplantı odası**, **katılımcı ve cihaz kontrolü (Pre-join)**, **interaktif gösterge paneli (Dashboard)**, **not ve aksiyon yönetimi** ile **detaylı analiz ve raporlama** modülleriyle eksiksiz bir kurumsal platforma dönüştürülmüştür.

---

## 🛠️ Yapılan Adımlar ve Değişiklikler (Adım Adım)

### 1. ⚙️ Bağımlılık ve Çevre Sorunlarının Çözülmesi
- **Pydantic Uyumluluk Hatası Giderildi:** Python ortamındaki `pydantic` ve `pydantic-core` kütüphaneleri arasındaki `ImportError: cannot import name 'validate_core_schema' from 'pydantic_core'` uyumsuzluğu tespit edildi. Kütüphaneler en güncel stabil sürümlerine yükseltilerek FastAPI ile %100 uyumlu hale getirildi.
- **Port ve Ağ Erişimi Optimizasyonu:** Windows ortamında port 8000 üzerindeki yetki ve kullanım çakışmaları tespit edilerek uygulama `http://127.0.0.1:8001` portuna yönlendirildi.
- **Veritabanı Fallback Mekanizması:** `app/core/database.py` içerisinde PostgreSQL bağlantısı kurulamadığında sistemin kesintisiz çalışması için yerel SQLite (`meeting_system.db`) veritabanına otomatik ve güvenli geçiş mekanizması doğrulandı.
- **Veritabanı Tohumlama (Seeding):** `seed.py` ve `user_seed.py` çalıştırılarak varsayılan **"Yönetim"** departmanı ve varsayılan **Yönetici (Admin)** hesabı veritabanına işlendi.

---

### 2. 🎨 Ön Yüz (Frontend) ve UI/UX Mimarisinin İhyası
Tüm arayüzler modern dark mode/light mode estetiği, glassmorphism efektleri, yumuşak geçiş animasyonları ve responsive mobil uyumlu tasarımla baştan inşa edildi:

* **Ana Düzen (`app/templates/base.html`):**
  - Tüm sayfalar için ortak sidebar, üst bar, bildirim menüsü ve dinamik kullanıcı profil bilgisi entegre edildi.
  - JWT token kontrolü ve yetkisiz erişimlerde otomatik oturum kapatma/yönlendirme yapısı eklendi.

* **Giriş Sayfası (`app/templates/login.html` & `app/static/js/auth.js`):**
  - Şık giriş formu, şifre görünürlüğü değiştirme (toggle), hata bildirim kartları ve `localStorage` JWT token saklama mantığı kuruldu.

* **Gösterge Paneli - Dashboard (`app/templates/index.html` & `app/static/js/dashboard.js`):**
  - **Özet Kartlar:** Toplam toplantı, aktif toplantı, yaklaşan toplantı ve toplam süre istatistikleri.
  - **Grafik Entegrasyonu:** Chart.js kullanılarak haftalık ve aylık toplantı katılım/süre trendleri görselleştirildi.
  - **Son Toplantılar Tablosu:** Yaklaşan ve tamamlanan toplantıların anlık durum kartları ve tek tıkla katılım butonları eklendi.

* **Toplantı Yönetimi (`app/templates/meetings.html` & `app/static/js/meetings.js`):**
  - Toplantı planlama modalı (Tarih, saat, süre, departman seçimi, katılımcı davetleri).
  - Anlık toplantı başlatma (Instant meeting).
  - Toplantı arama, filtreleme, bağlantı kopyalama ve paylaşma özellikleri.

* **Canlı WebRTC / LiveKit Toplantı Odası (`app/templates/room.html` & `app/static/js/webrtc.js` & `prejoin.js`):**
  - **Pre-join (Ön Katılım) Önizleme:** Oditoryuma girmeden önce kamera, mikrofon seçimi, ses seviyesi göstergesi (Audio meter) ve canlı video önizleme ekranı.
  - **Canlı Video Grid Layout:** Aktif konuşmacı vurgulama (Active speaker detection indicator).
  - **Medya Kontrolleri:** Mikrofon aç/kapat, kamera aç/kapat, ekran paylaşımı (`getDisplayMedia`), toplantıyı sonlandır.
  - **Yan Paneller:** Canlı sohbet (Chat), Katılımcı listesi, Toplantı esnasında not alma ve aksiyon maddesi ekleme modalı.
  - **Canlı Süre Sayacı ve Kayıt Durumu.**

* **Detaylı Raporlama Sayfası (`app/templates/report.html` & `app/static/js/report.js`):**
  - Toplantı katılım analitiği, katılımcı giriş/çıkış zaman çizelgesi.
  - Toplantı esnasında alınan notlar ve tanımlanan aksiyon maddeleri listesi.
  - Rapor dışa aktarma (PDF/Print) desteği.

---

### 3. ⚙️ Arka Yüz (Backend) ve API Katmanı
- **`app/main.py`:** FastAPI yönlendirmeleri, CORS politikaları, statik dosya ve Jinja2 şablon sunumu yapılandırıldı.
- **REST API Rotası Entegrasyonları (`app/routes/`):**
  - `auth.py`: Giriş doğrulaması ve JWT token üretimi.
  - `users.py`: Kullanıcı yönetimi ve profil sorguları.
  - `meetings.py`: Toplantı oluşturma, güncelleme, silme ve listeleme.
  - `dashboard.py`: Dashboard kartları ve grafikler için analitik veri uçları.
  - `participants.py` & `participant_sessions.py`: Katılımcı durumları ve oturum sürelerinin takibi.
  - `meeting_notes.py` & `meeting_actions.py`: Not ve aksiyon maddeleri yönetimi.
  - `signaling.py`: WebRTC sinyalleşme ve LiveKit erişim token üretimi.

---

## 📦 Kullanılan Kütüphaneler ve Teknolojiler

### Backend (Python):
* **FastAPI (v0.111.0):** Yüksek performanslı asenkron REST API sunucusu.
* **Uvicorn (v0.30.1):** ASGI sunucusu.
* **SQLAlchemy (v2.0.31):** ORM veritabanı yönetim katmanı.
* **Pydantic (v2.13.4) & Pydantic-Settings:** Veri doğrulama ve çevre değişkenleri yönetimi.
* **PyJWT & Passlib / Bcrypt:** Güvenli parola hashleme ve JWT token kimlik doğrulama.
* **Jinja2 (v3.1.6):** Sunucu taraflı HTML şablon motoru.
* **LiveKit API (v1.2.0):** Görüntülü ve sesli WebRTC medyası için sinyalleşme entegrasyonu.

### Frontend:
* **HTML5 / CSS3 (Vanilla CSS + Modern Design Tokens):** Dark mode, Glassmorphism.
* **JavaScript (ES6 Modules):** WebRTC API (`getUserMedia`, `getDisplayMedia`), Fetch API, LocalStorage.
* **Chart.js:** İnteraktif gösterge paneli grafikleri.
* **FontAwesome / Lucide Icons:** Modern ikon setleri.

---

## 🔑 Varsayılan Giriş Bilgileri

Uygulama ilk açıldığında aşağıdaki yönetici hesabı ile giriş yapabilirsiniz:

* **E-Posta:** `admin@yebsoft.net`
* **Şifre:** `YEBsoft2026!`
* **Rol:** `admin`

---

## 🚀 Projeyi Çalıştırma Adımları

1. **Bağımlılıkların Yüklenmesi:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Veritabanının Tohumlanması (Seed):**
   ```bash
   python seed.py
   python user_seed.py
   ```

3. **Uygulama Sunucusunun Başlatılması:**
   ```bash
   python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
   ```

4. **Tarayıcıda Erişilmesi:**
   - **Giriş Sayfası:** `http://127.0.0.1:8001/login`
   - **Gösterge Paneli:** `http://127.0.0.1:8001/`
   - **API Dokümantasyonu (Swagger):** `http://127.0.0.1:8001/docs`

---

## 📊 Aktif ve Pasif Yapılan Özellik Özeti

| Özellik | Durum | Açıklama |
| :--- | :---: | :--- |
| **JWT Kimlik Doğrulama** | ✅ Aktif | Oturum yönetimi `localStorage` ile güvenli şekilde yapılıyor. |
| **SQLite Veritabanı Fallback** | ✅ Aktif | PostgreSQL yoksa otomatik olarak `meeting_system.db` kullanılıyor. |
| **Pre-join Cihaz Testi** | ✅ Aktif | Kamera/Mikrofon seçimi ve canlı ses seviyesi ölçümü yapılıyor. |
| **WebRTC Media & Screen Share** | ✅ Aktif | Ekran paylaşımı, mikrofon ve kamera geçişleri aktif. |
| **Canlı Sohbet & Not Alma** | ✅ Aktif | Odada anlık mesajlaşma ve not/aksiyon kaydı aktif. |
| **Chart.js İstatistikler** | ✅ Aktif | Dashboard üzerinde canlı metrik grafikleri sunuluyor. |
| **PostgreSQL Veritabanı** | ⏸️ Opsiyonel (Pasif) | Canlı ortama geçildiğinde `.env` dosyasından aktifleştirilebilir. |

---
*Yebsoft Görüntülü ve Sesli Toplantı Yönetim Sistemi - 2026*

/* ==========================================================================
   SYSTEM REAL-TIME EVENT SYNC MODULE (WebSocket & Visibility Auto-Sync)
   ========================================================================== */

const EventSync = {
  socket: null,
  reconnectAttempts: 0,
  maxReconnectDelay: 30000,
  pingInterval: null,
  isInitialized: false,

  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Sadece oturum açmış kullanıcılar için WebSocket bağlantısı kur
    const token = Auth.getToken();
    if (!token) return;

    this.connect();
    this.setupVisibilityListener();
  },

  connect() {
    const token = Auth.getToken();
    if (!token) return;

    // Protokol (ws:// veya wss://)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/events?token=${encodeURIComponent(token)}`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log("⚡ [EventSync] Canlı senkronizasyon kanalına bağlandı.");
        this.reconnectAttempts = 0;
        this.startPing();
      };

      this.socket.onmessage = (event) => {
        if (event.data === 'pong') return;
        try {
          const payload = JSON.parse(event.data);
          this.handleEvent(payload);
        } catch (err) {
          console.warn("[EventSync] Mesaj ayrıştırma hatası:", err);
        }
      };

      this.socket.onclose = (e) => {
        this.stopPing();
        if (e.code !== 1000) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = (err) => {
        console.warn("[EventSync] WebSocket hatası:", err);
        if (this.socket) this.socket.close();
      };
    } catch (e) {
      console.warn("[EventSync] Bağlantı kurulamadı:", e);
      this.scheduleReconnect();
    }
  },

  handleEvent(payload) {
    const eventType = payload.event;
    const data = payload.data;

    console.log(`📡 [EventSync] Olay Alındı: ${eventType}`, data);

    // 1. Genel CustomEvent fırlat
    window.dispatchEvent(new CustomEvent('system:event', { detail: payload }));

    // 2. Özel modül bildirimleri fırlat
    if (['MEETING_CREATED', 'MEETING_UPDATED', 'MEETING_CANCELLED', 'MEETING_DELETED', 'SESSION_STARTED', 'SESSION_CLOSED'].includes(eventType)) {
      window.dispatchEvent(new CustomEvent('meeting:changed', { detail: payload }));
    }

    // 3. Kullanıcıya bildirim göster (Eğer başkası toplantı ekledi/güncelledi ise)
    if (eventType === 'MEETING_CREATED' && typeof Notifications !== 'undefined') {
      Notifications.show(`" ${data.title || 'Yeni Toplantı'} " takvime eklendi.`, 'info', 'Yeni Toplantı');
    }

    // BUG FIX: Bir toplantı oluşturulup davet gönderildiğinde (bu, backend'de
    // aynı anda davet edilen kullanıcılar için bir Notification satırı da
    // oluşturuyor — bkz. services/meetings.py create_new_meeting) ekranın
    // altında toast görünüyordu ama navbar'daki bildirim zili (rozet sayısı +
    // açılır liste) hiç yenilenmiyordu, kullanıcı sayfayı yenileyene kadar
    // eski/güncelsiz kalıyordu. Artık aynı olay grubunda bildirim zili de
    // sessizce (toast göstermeden) API'den yeniden çekilip güncelleniyor.
    if (['MEETING_CREATED', 'MEETING_UPDATED', 'MEETING_CANCELLED', 'MEETING_DELETED'].includes(eventType) && typeof Notifications !== 'undefined' && Notifications.fetchNotifications) {
      Notifications.fetchNotifications();
    }
  },

  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);
    console.log(`[EventSync] Yeniden bağlanıyor (${delay}ms)...`);
    setTimeout(() => {
      this.connect();
    }, delay);
  },

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send('ping');
      }
    }, 25000);
  },

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  },

  setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log("👁️ [EventSync] Sekme aktif oldu, güncel veriler çekiliyor...");
        // Sekme tekrar aktif olduğunda güncel veriyi tetikle
        window.dispatchEvent(new CustomEvent('meeting:changed', { detail: { event: 'TAB_VISIBLE' } }));

        // Eğer socket kopmuşsa yeniden bağla
        if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
          this.connect();
        }
      }
    });
  }
};

// Sayfa yüklendiğinde otomatik başlat
document.addEventListener('DOMContentLoaded', () => {
  // Auth kütüphanesi hazır olduktan hemen sonra başlat
  setTimeout(() => EventSync.init(), 300);
});

/* ==========================================================================
   WEBRTC REAL-TIME VIDEO & SIGNALING MODULE
   ========================================================================== */

const WebRTC = {
  socket: null,
  meetingCode: '',
  localStream: null,
  peers: {}, // { userId: RTCPeerConnection }
  peerStreams: {}, // { userId: webcamMediaStream }
  peerScreenStreams: {}, // { userId: screenShareMediaStream }
  pendingDepartures: {}, // { userId: { timerId, userInfo } } for page refresh grace period
  meetingInfo: null,
  startTime: null,
  timerInterval: null,

  isHost: false,
  currentUser: null,
  isRoomJoined: false,

  // TEK YETKİLİ "EDİTÖR": Sunucunun (SignalingManager._recompute_editor) o an
  // atadığı, lobi giriş taleplerini gerçekten görüp onaylayan/reddeden tek
  // kişinin user_id'si. Diğer tüm ayrıcalıklı (admin/manager) kullanıcılar
  // isUserHost() ile toplantının tüm diğer fonksiyonlarına erişmeye devam
  // eder — sadece bu kuyruğu görmezler (ekran kalabalığı/çelişen onay-red
  // önlenir). 'editor-changed' / 'editor-assigned' mesajlarıyla güncellenir.
  currentEditorId: null,
  isEditor() {
    return Boolean(this.currentEditorId && this.currentUser?.id &&
      String(this.currentEditorId) === String(this.currentUser.id));
  },

  isMicMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  screenTrack: null,
  screenAudioTrack: null,

  remoteVolumes: {},
  remoteMuted: {},
  pinnedTileId: null,

  getIceServers() {
    if (window.ICE_SERVERS) return window.ICE_SERVERS;

    const host = window.location.hostname;
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];

    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      servers.push({ urls: `stun:${host}:3478` });
      servers.push({
        urls: [
          `turn:${host}:3478?transport=udp`,
          `turn:${host}:3478?transport=tcp`
        ],
        username: 'yebsoft_turn_user',
        credential: 'yebsoft_turn_password_2026'
      });
    }

    if (window.TURN_CONFIG) {
      servers.push(window.TURN_CONFIG);
    }

    return {
      iceServers: servers,
      iceCandidatePoolSize: 10
    };
  },

  bindAutoplayUnlock() {
    if (this._autoplayUnlocked) return;
    this._autoplayUnlocked = true;

    const unlock = () => {
      document.querySelectorAll('audio, video').forEach(el => {
        if (el.srcObject && el.paused) {
          el.play().catch(() => { });
        }
      });
    };

    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  },

  optimizeSDP(sdp) {
    if (!sdp) return sdp;
    // 1. Opus HD Constant Bitrate & zero-dtx for latency-free A/V sync
    sdp = sdp.replace(/a=fmtp:111 (.*)/g, 'a=fmtp:111 $1;maxaveragebitrate=128000;stereo=1;sprop-stereo=1;cbr=1;usedtx=0');

    // 2. Inject WebRTC minimum & start bitrate flags for ultra-smooth video playback
    if (sdp.includes('a=mid:video') || sdp.includes('m=video')) {
      sdp = sdp.replace(/a=fmtp:(\d+) (.*)/g, 'a=fmtp:$1 $2;x-google-min-bitrate=1500;x-google-start-bitrate=3500;x-google-max-bitrate=4500');
    }
    return sdp;
  },

  pendingCandidates: {}, // { userId: [candidates] }

  async joinRoom(meetingCode, existingStream = null, isMicMuted = false, isCameraOff = false) {
    this.meetingCode = meetingCode;
    this.currentUser = Auth.getUser();
    this.isMicMuted = isMicMuted;
    this.isCameraOff = isCameraOff;

    // Reset stale screen share state on join/refresh
    this.screenSharePresenterId = null;
    this.isScreenSharing = false;
    this.screenStream = null;
    sessionStorage.removeItem('meeting_screen_sharing');
    this.disableScreenShareLayout();

    this.bindAutoplayUnlock();

    // BUG FIX: Sayfa her açıldığında (F5 dahil), kartın gerçek konteyner
    // boyutu (kenar paneli/üst şerit CSS'i henüz oturmadan) İLK reflow'da
    // yanlış/geçici ölçülüp, hemen ardından (ResizeObserver'ın gerçek boyutu
    // tespit etmesiyle) doğru değere düzeltiliyordu. `.participant-tile`'ın
    // width/height geçişi (0.2s) bu iki ölçüm arasındaki farkı ANİMASYONLA
    // gösterdiğinden, kullanıcının kendi kartı büyüyüp küçülüyormuş gibi
    // (sanki tam ekrana girip çıkıyormuş gibi) bir "titreme" oluşuyordu.
    // Yerleşim daha oturmadan bu geçişi geçici olarak kapatıyoruz.
    const initialGrid = document.getElementById('videoGrid');
    if (initialGrid) initialGrid.classList.add('suppress-tile-transition');

    // BUG FIX: F5 ile sayfa yenilendiğinde sohbet tamamen sıfırlanıyordu —
    // artık aynı sekme/oturum içinde (sessionStorage) saklanan geçmiş geri
    // oynatılıyor. Gerçek "sıfırlama" sadece bilinçli "Ayrıl"da olur (bkz.
    // leaveMeeting/endMeeting -> clearChatHistory()).
    this.restoreChatHistory();

    // Fetch Meeting Details
    await this.fetchMeetingInfo();
    await this.loadExistingNotes();

    // Setup Local Stream
    if (existingStream) {
      this.localStream = existingStream;
    } else {
      try {
        const camId = sessionStorage.getItem('meeting_cam_id');
        const micId = sessionStorage.getItem('meeting_mic_id');

        const videoConstraints = camId ? { deviceId: { exact: camId } } : true;
        const audioConstraints = micId ? { deviceId: { exact: micId } } : true;

        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: audioConstraints
        });
      } catch (err) {
        console.warn("Spesifik medya cihazı akışı alınamadı, varsayılan deneniyor:", err);
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
        } catch (err2) {
          console.warn("Medya akışı alınamadı, kameranız veya mikrofonunuz kapalı kalacak:", err2);
        }
      }
    }

    // GÜVENCE (savunma amaçlı, ikinci katman): Prejoin ekranından gelen
    // isCameraOff/isMicMuted bayrakları bazen cihazın GERÇEK donanım durumuyla
    // (kamera/mikrofon hiç yoksa) uyuşmuyordu — kart üst barda ve Kişiler
    // barında "açık" görünüp altında gerçekte hiç video/audio track'i
    // olmuyordu. Burada gerçek stream'in track'lerine bakılarak durum kesin
    // olarak düzeltiliyor: track yoksa "açık" gösterilemez.
    if (!this.localStream || this.localStream.getVideoTracks().length === 0) {
      this.isCameraOff = true;
    }
    if (!this.localStream || this.localStream.getAudioTracks().length === 0) {
      this.isMicMuted = true;
    }

    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);

      // Mevcut tüm akran bağlantılarına yerel medya kanallarını anında kilitler
      Object.values(this.peers).forEach(pc => this.attachLocalTracksToPeer(pc));
    }

    this.renderLocalTile();
    this.updateMicUI();
    this.updateCameraUI();
    this.setupResponsiveGridObserver();
    this.connectWebSocket();
    this.startTimer();
    this.bindRoomControls();
    this._setupScreenShareAspectRatioSync();
    this._setupDeviceChangeWatcher();

    // Pencere yeniden boyutlandırıldığında üst şeridin ortalı/sola-dayalı
    // taşma durumu (bkz. reflowTopCarouselBar) da yeniden değerlendirilsin.
    if (!this._resizeListenerBound) {
      this._resizeListenerBound = true;
      let resizeDebounce = null;
      window.addEventListener('resize', () => {
        clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => this.reflowTopCarouselBar(), 120);
      });
    }

    // Yerleşim birkaç reflow turuyla (ResizeObserver dahil) oturduktan sonra
    // geçişi geri açıyoruz — bundan sonraki GERÇEK boyut değişiklikleri
    // (katılımcı ekleme/çıkarma, ekran paylaşımı vb.) yine yumuşak animasyonlu
    // kalıyor, sadece açılıştaki "titreme" bastırılıyor.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          const g = document.getElementById('videoGrid');
          if (g) g.classList.remove('suppress-tile-transition');
        }, 250);
      });
    });

    // BUG FIX: Burada eskiden bir 'beforeunload' listener'ı vardı ve F5/sayfa
    // yenilemesinde soket henüz açıkken senkron olarak 'screen-share-stop'
    // gönderiyordu — bu, sunucu tarafındaki Grace Period mekanizmasını
    // (bkz. SignalingManager._schedule_screen_share_stop) tamamen by-pass
    // edip paylaşımı gereksiz yere anında kesiyordu. Artık F5/kopma/kapatma
    // senaryolarının TÜMÜ, "geri döndü mü" ayrımını doğru yapan tek mekanizma
    // olan sunucu tarafı Grace Period'a bırakılıyor. Bilinçli "Paylaşımı
    // Durdur" tıklaması zaten stopScreenShare() üzerinden ayrı bir sinyal
    // gönderdiği için bundan etkilenmiyor.
  },

  // Sidebar'daki "Genel Notlar" sub-tab'i, Kişisel Notlar'a geçilip geri
  // dönüldüğünde kartların hâlâ DOM'da olacağını varsayıyordu (bkz.
  // room.html renderSidebarNotesFeed) — ama Kişisel Notlar'a geçiş konteyner'ın
  // TÜM innerHTML'ini kişisel notlarla değiştiriyor, genel not kartlarını
  // yok ediyordu. Genel notlar artık burada (WebRTC tarafında) bir önbellekte
  // de tutuluyor; room.html geri dönüşte bu önbellekten yeniden çiziyor.
  generalNotesCache: [],

  async loadExistingNotes() {
    if (!this.meetingInfo?.id) return;
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    try {
      const res = await fetch(`/api/v1/notes/meeting/${this.meetingInfo.id}`, {
        headers: Auth.getAuthHeaders()
      });
      if (res.ok) {
        const notes = await res.json();
        // BUG FIX: Backend bu uç noktadan genel notlarla BİRLİKTE kullanıcının
        // kendi kişisel notlarını da (note_type: 'personal') karışık döndürüyor
        // — eskiden hepsi ayrım yapılmadan "Toplantı Kararı" kartı olarak genel
        // akışa (hem sidebar hem dashboard) basılıyordu, yani kişisel notlar
        // yanlışlıkla herkese açık gibi görünen bir bölümde beliriyordu. Artık
        // sadece 'general' (veya tipi belirtilmemiş eski kayıtlar) burada
        // gösteriliyor; kişisel notlar zaten ayrı olarak localStorage'dan
        // (renderSidebarNotesFeed) render ediliyor.
        // Ayrıca backend en yeniden en eskiye sıralı döndürüyor; renderLiveNote
        // prepend ettiği için sırayla işlenirse ters (eski üstte) görünüyordu —
        // ters çevirip prepend edince doğru (en yeni üstte) sıra elde ediliyor.
        const generalNotes = notes.filter(n => (n.note_type || 'general') === 'general');
        generalNotes.slice().reverse().forEach(note => {
          this.renderLiveNote({
            content: note.content,
            author: 'Toplantı Notu',
            created_at: new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            // BUG FIX: Sayfa yüklenirken çekilen (daha önce yayınlanmış) genel
            // notlar için de note_id/sender_id iletiliyor — böylece kendi
            // yazdığınız eski bir genel not, sayfayı yenilediğinizde de
            // silinebilir kalıyor (önceden bu bilgi hiç aktarılmıyordu).
            note_id: note.id,
            sender_id: note.author_id
          });
        });
      }
    } catch (e) {
      console.warn("Mevcut notlar çekilemedi:", e);
    }
  },

  async fetchMeetingInfo() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const guestToken = urlParams.get('guest_token') || sessionStorage.getItem('guest_token');

      let response;
      if (guestToken) {
        // Misafir jetonunu backend API üzerinden doğrula
        const valRes = await fetch(`/api/v1/guest/validate?token=${encodeURIComponent(guestToken)}`);
        if (!valRes.ok) {
          console.warn("Misafir jetonu geçersiz veya süresi dolmuş.");
          sessionStorage.removeItem('guest_token');
          if (window.Notifications) {
            Notifications.show("Misafir katılım jetonunuzun süresi dolmuş veya geçersiz.", "danger", "Yetkisiz Erişim");
          }
          setTimeout(() => {
            window.location.replace(`/guest/${this.meetingCode}`);
          }, 1000);
          return;
        }

        const payloadData = await valRes.json();
        if (payloadData.meeting_code && payloadData.meeting_code !== this.meetingCode) {
          console.warn("Misafir jetonu başka bir odaya ait. Yeni oda giriş portalına yönlendiriliyor.");
          sessionStorage.removeItem('guest_token');
          window.location.replace(`/guest/${this.meetingCode}`);
          return;
        }

        sessionStorage.setItem('guest_token', guestToken);

        response = await fetch(`/api/v1/guest/meeting/${this.meetingCode}`);
        if (response.ok) {
          this.meetingInfo = await response.json();
          this.currentUser = {
            id: payloadData.guest_id,
            first_name: payloadData.guest_name,
            last_name: '(Misafir)',
            role: 'guest'
          };
          this.isHost = false;
        }
      } else {
        const token = Auth.getToken();
        if (!token) {
          // Token veya misafir jetonu bulunmadığı için doğrudan misafir giriş sayfasına yönlendir
          window.location.replace(`/guest/${this.meetingCode}`);
          return;
        }

        response = await Auth.fetchWithAuth(`/api/v1/meetings/code/${this.meetingCode}`);
        if (response.ok) {
          this.meetingInfo = await response.json();

          if (typeof Auth !== 'undefined' && Auth.getCurrentUser) {
            this.currentUser = Auth.getCurrentUser();
          } else if (typeof Auth !== 'undefined' && Auth.getUser) {
            this.currentUser = Auth.getUser();
          }

          const creatorId = String(this.meetingInfo?.created_by || '').toLowerCase();
          const userId = String(this.currentUser?.id || this.currentUser?.user_id || '').toLowerCase();
          const isCreator = Boolean(creatorId && userId && creatorId === userId);
          const isAdmin = Boolean(this.currentUser && (this.currentUser.role === 'admin' || this.currentUser.role === 'host' || this.currentUser.role === 'manager' || this.currentUser.is_superuser));

          this.isHost = Boolean(isCreator || isAdmin);
        } else if (response.status === 401 || response.status === 403) {
          window.location.replace('/login');
          return;
        }
      }

      if (this.meetingInfo) {
        const titleEl = document.getElementById('roomTitle');
        if (titleEl) titleEl.textContent = this.meetingInfo.title;

        // Toplantı Sahibi Paneli Kontrollerini Göster
        const hostPanel = document.getElementById('hostControlsPanel');
        if (hostPanel) hostPanel.style.display = this.isUserHost() ? 'flex' : 'none';

        const hostNoteSection = document.getElementById('hostNoteSection');
        if (hostNoteSection) hostNoteSection.style.display = this.isUserHost() ? 'block' : 'none';

        const hostAdminActions = document.getElementById('hostAdminActions');
        if (hostAdminActions) hostAdminActions.style.display = this.isUserHost() ? 'block' : 'none';

        const btnEndBar = document.getElementById('btnEndMeetingHostBar');
        if (btnEndBar) btnEndBar.style.display = this.isUserHost() ? 'inline-flex' : 'none';

        const btnEndPopover = document.getElementById('btnEndMeetingHostPopover');
        if (btnEndPopover) btnEndPopover.style.display = this.isUserHost() ? 'flex' : 'none';

        // BUG FIX: Misafir ve sıradan katılımcının (editör/admin/manager/host
        // OLMAYAN herkesin) oda yönetimiyle hiçbir işi yok — "..." (üç nokta)
        // menüleri (link kopyalama, davet, oda ayarları) TAMAMEN gizlenir; Ayrıl
        // butonu da "Toplantıyı Herkes İçin Sonlandır" seçeneğine giden ok
        // işaretini kaybedip düz/tek amaçlı bir "Ayrıl" butonuna döner.
        const headerMoreWrap = document.getElementById('headerMoreOptionsWrapper');
        if (headerMoreWrap) headerMoreWrap.style.display = this.isUserHost() ? 'inline-flex' : 'none';

        const bottomMoreWrap = document.getElementById('bottomMoreOptionsWrapper');
        if (bottomMoreWrap) bottomMoreWrap.style.display = this.isUserHost() ? 'flex' : 'none';

        const leaveChevronBtn = document.getElementById('headerLeaveChevronBtn');
        const leaveSplitBtn = document.getElementById('headerLeaveSplitBtn');
        if (leaveChevronBtn) leaveChevronBtn.style.display = this.isUserHost() ? 'inline-flex' : 'none';
        if (leaveSplitBtn && !this.isUserHost()) leaveSplitBtn.style.borderRadius = '10px';

        // Yönetici olmayan kullanıcılar için Oda Düzenleme ve Davet butonlarını gizle (Sadece link kopyalama kalsın)
        const btnOptionInvite = document.getElementById('btnOptionInviteUser');
        if (btnOptionInvite) btnOptionInvite.style.display = this.isUserHost() ? 'flex' : 'none';

        const btnOptionSettings = document.getElementById('btnOptionEditSettings');
        if (btnOptionSettings) btnOptionSettings.style.display = this.isUserHost() ? 'flex' : 'none';

        // BUG FIX: Kişiler barındaki "Genel Notlar" oluşturma formu (sidebarNoteText
        // + yayınla butonu) eskiden sub-tab tıklanana kadar HERKESE görünür
        // kalıyordu (varsayılan inline stilde gizli değildi). Editör/yönetici
        // bilgisi burada netleştiği anda, kullanıcı hiç sub-tab'e tıklamasa
        // bile doğru görünürlük baştan uygulanır — sadece görüntüleme
        // yetkisi olanlar formu asla görmez.
        const sidebarNoteForm = document.getElementById('sidebarNoteFormContainer');
        const sidebarNoteViewOnlyNotice = document.getElementById('sidebarGeneralNoteViewOnlyNotice');
        if (sidebarNoteForm && sidebarNoteViewOnlyNotice) {
          const noteType = (typeof currentSidebarNoteType !== 'undefined') ? currentSidebarNoteType : 'general';
          const showNoteForm = (noteType !== 'general') || this.isUserHost();
          sidebarNoteForm.style.display = showNoteForm ? 'flex' : 'none';
          sidebarNoteViewOnlyNotice.style.display = showNoteForm ? 'none' : 'block';
        }

        if (this.isUserHost()) {
          this.startLobbyPolling();
        }
      }
    } catch (e) {
      console.warn("Toplantı detayları alınamadı:", e);
    }
  },

  isUserHost() {
    if (this.isHost) return true;
    const u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : this.currentUser;
    if (u) {
      const role = String(u.role || '').toLowerCase();
      if (['admin', 'manager', 'host', 'moderator', 'yönetici', 'yonetici', 'müdür', 'mudur'].includes(role) || u.is_superuser) return true;
      if (this.meetingInfo && this.meetingInfo.created_by) {
        const creatorId = String(this.meetingInfo.created_by).toLowerCase();
        const userId = String(u.id || u.user_id || u.sub || '').toLowerCase();
        if (userId && creatorId === userId) return true;
      }
    }
    return false;
  },

  canShareScreenDirectly() {
    if (this.isHost || this.isUserHost() || this.approvedScreenShare) return true;
    const u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : this.currentUser;
    if (u) {
      const role = String(u.role || '').toLowerCase();
      if (['admin', 'manager', 'host', 'moderator', 'yönetici', 'yonetici', 'müdür', 'mudur'].includes(role) || u.is_superuser) return true;
    }
    return false;
  },

  startLobbyPolling() {
    if (this.lobbyPollInterval) clearInterval(this.lobbyPollInterval);

    this.lobbyPollInterval = setInterval(async () => {
      if (!this.meetingCode || !this.isUserHost()) return;
      try {
        const res = await fetch(`/api/v1/signaling/lobby/${this.meetingCode}`, {
          headers: (typeof Auth !== 'undefined' && Auth.getAuthHeaders) ? Auth.getAuthHeaders() : {}
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.pending_requests)) {
            data.pending_requests.forEach(req => {
              if (req) this.showLobbyApprovalNotification(req);
            });
          }
        }
      } catch (e) { }
    }, 3000);
  },

  participantsMap: {}, // { userId: { id, name, avatar_url, role, isMicMuted, isCameraOff } }

  // Otomatik yeniden bağlanma + kalp atışı durumu. Bunlar olmadan, yarı-kopuk
  // (half-open) bir bağlantı istemci tarafında hiç fark edilmeden sessizce
  // ölü kalabiliyordu: sunucu 4sn grace-period sonunda kullanıcıyı odadan
  // düşürüyor ama istemci "hala bağlıyım" sanıp yeni katılan/kamera açıp
  // kapatan kimseyi bir daha asla göremiyordu — F5 tek çözümdü.
  signalingReconnectAttempts: 0,
  signalingMaxReconnectDelay: 20000,
  signalingHeartbeatTimer: null,
  signalingReconnectTimer: null,
  // Bu kodlarla kapanan bir bağlantı KASITLIDIR (yetkisiz erişim/kick/misafir
  // reddi) — yeniden bağlanmaya ÇALIŞILMAMALI, aksi halde kullanıcı odadan
  // atıldıktan hemen sonra kendini tekrar odaya sokmaya çalışan bir döngüye
  // girer.
  // NOT: 1000 (normal kapanış) buna bilerek dahil EDİLMEDİ — sunucu yeniden
  // başlatma/deploy gibi durumlarda da bu kodla kapanabiliyor ve tam olarak
  // böyle anlarda otomatik toparlanmasını istiyoruz. Kasıtlı "Ayrıl"/"Toplantıyı
  // Bitir" akışları zaten hemen `window.location` ile sayfadan ayrılıyor,
  // yani bu handler'ın reconnect dener durumda kalmasına fırsat kalmıyor.
  SIGNALING_NO_RECONNECT_CODES: [1008, 4001, 4003],

  connectWebSocket() {
    const urlParams = new URLSearchParams(window.location.search);
    const guestToken = urlParams.get('guest_token') || sessionStorage.getItem('guest_token');
    const token = Auth.getToken();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = '';

    // KRİTİK BUG FIX (kamerası açık gelen yeni katılımcı görünmüyordu): Sunucu
    // eskiden isCameraOff/isMicMuted'ı bağlantı anında hep True sabitliyordu;
    // gerçek durum sadece daha sonra (sessizce yayınlanmayan) bir düzeltme
    // mesajıyla geliyordu. Artık gerçek durum, in_lobby ile aynı yöntemle,
    // bağlantı ANINDA query param olarak taşınıyor — joinRoom() bu noktaya
    // gelene kadar (satır ~110-181) this.isCameraOff/this.isMicMuted zaten
    // kesinleşmiş (gerçek getUserMedia track varlığına göre düzeltilmiş) durumda.
    const camMicParams = `&is_camera_off=${this.isCameraOff}&is_mic_muted=${this.isMicMuted}`;

    if (guestToken) {
      wsUrl = `${protocol}//${window.location.host}/api/v1/signaling/ws/${this.meetingCode}?guest_token=${encodeURIComponent(guestToken)}${camMicParams}`;
    } else {
      wsUrl = `${protocol}//${window.location.host}/api/v1/signaling/ws/${this.meetingCode}?token=${token}${camMicParams}`;
    }

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log("WebSocket Sinyalleşme Sunucusuna Bağlandı.");
      this.updateConnectionBadge('online', 'Bağlı');
      this.signalingReconnectAttempts = 0;
      this.startSignalingHeartbeat();
      this.startRoomSync();

      const myName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Kullanıcı';
      const myRole = (this.isHost || this.isUserHost()) ? 'admin' : (this.currentUser?.role || 'user');

      this.participantsMap[this.currentUser.id] = {
        id: this.currentUser.id,
        name: myName,
        avatar_url: this.currentUser?.avatar_url,
        role: myRole,
        isMicMuted: this.isMicMuted,
        isCameraOff: this.isCameraOff
      };
      this.renderParticipantsList();

      if (!this.isRoomJoined) {
        this.isRoomJoined = true;
        const sessionKey = `meeting_joined_${this.meetingCode}_${this.currentUser?.id}`;
        const isReconnect = Boolean(sessionStorage.getItem(sessionKey));
        sessionStorage.setItem(sessionKey, '1');

        this.sendSignal({
          type: 'user-joined',
          is_reconnect: isReconnect,
          user_info: {
            id: String(this.currentUser?.id),
            name: myName,
            avatar_url: this.currentUser?.avatar_url,
            role: this.isHost ? 'admin' : (this.currentUser?.role || 'user'),
            isMicMuted: this.isMicMuted,
            isCameraOff: this.isCameraOff
          }
        });
      }
    };

    this.socket.onmessage = async (event) => {
      if (event.data === 'pong') return; // Kalp atışı yanıtı — sinyal işlemeye gitmesin
      try {
        const data = JSON.parse(event.data);
        await this.handleSignal(data);
      } catch (err) {
        console.error("Sinyal mesajı işleme hatası:", err);
      }
    };

    this.socket.onerror = () => {
      this.updateConnectionBadge('reconnecting', 'Yeniden Bağlanıyor...');
    };

    this.socket.onclose = (event) => {
      this.updateConnectionBadge('offline', 'Bağlantı Kesildi');
      this.stopSignalingHeartbeat();
      this.stopRoomSync();

      if (event && (event.code === 1008 || event.code === 4001)) {
        if (window.Notifications) {
          Notifications.show("Toplantı oda erişim yetkiniz doğrulanamadı.", "danger", "Erişim Reddedildi");
        }
        setTimeout(() => {
          const guestToken = sessionStorage.getItem('guest_token');
          if (guestToken) {
            sessionStorage.removeItem('guest_token');
            window.location.replace(`/guest/${this.meetingCode}`);
          } else {
            window.location.replace('/login');
          }
        }, 1000);
        return;
      }

      // BUG FIX: Buradan önce hiçbir yeniden bağlanma denemesi YOKTU. Ağ
      // kesintisi, kısa bir Wi-Fi kopması, laptop uyku modundan çıkışı,
      // kurumsal proxy'nin boşta kalan soketi kesmesi gibi TAMAMEN NORMAL
      // durumlarda bile bağlantı sessizce kopup bir daha asla kendini
      // toparlamıyordu — kullanıcı sayfayı F5'lemeden yeni katılan kimseyi
      // veya kamera/mikrofon değişikliklerini bir daha göremiyordu. Kicked/
      // reddedilme/misafir onaysızlığı gibi KASITLI kapanma kodlarında
      // (SIGNALING_NO_RECONNECT_CODES) yeniden bağlanmayı denemiyoruz.
      if (event && this.SIGNALING_NO_RECONNECT_CODES.includes(event.code)) {
        return;
      }
      if (!this.meetingCode || !this.isRoomJoined) return; // Oda bilinçli olarak terk edildi

      this.signalingReconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(1.5, this.signalingReconnectAttempts), this.signalingMaxReconnectDelay);
      console.warn(`[WebRTC] Sinyalleşme bağlantısı koptu, ${delay}ms sonra yeniden bağlanılacak (deneme ${this.signalingReconnectAttempts})...`);
      clearTimeout(this.signalingReconnectTimer);
      this.signalingReconnectTimer = setTimeout(() => {
        this.updateConnectionBadge('reconnecting', 'Yeniden Bağlanıyor...');
        this.connectWebSocket();
      }, delay);
    };
  },

  startSignalingHeartbeat() {
    this.stopSignalingHeartbeat();
    // events.js'teki EventSync ile aynı ritimde (25sn): bağlantı gerçekten
    // canlı mı diye periyodik olarak sunucuya "ping" gönderir. Yarı-kopuk
    // bağlantılar genelde sessizce hiçbir hata fırlatmadan takılı kalır;
    // düzenli ping/pong, tarayıcının bunu normalden çok daha hızlı fark
    // etmesini (ve onclose/reconnect akışını tetiklemesini) sağlar.
    this.signalingHeartbeatTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send('ping');
      }
    }, 25000);
  },

  stopSignalingHeartbeat() {
    if (this.signalingHeartbeatTimer) {
      clearInterval(this.signalingHeartbeatTimer);
      this.signalingHeartbeatTimer = null;
    }
  },

  // PERİYODİK KENDİ-KENDİNİ-ONARAN SENKRON: WebSocket gerçek-zamanlı olay
  // sisteminin YERİNE değil, ÜZERİNE eklenen bir güvenlik ağı. Ağ
  // dalgalanması/kaçırılan tek bir mesaj yüzünden bir katılımcının kartı,
  // mikrofon/kamera durumu ya da ekran paylaşımı görünümü kalıcı olarak
  // yanlış kalmasın diye sunucudaki "authoritative" durumu ~3sn'de bir
  // sessizce sorar (bkz. handleSignal 'room-sync'). Sadece GERÇEK bir fark
  // varsa DOM'a dokunulur — aksi halde hiçbir şey yapılmaz (titreme yok).
  ROOM_SYNC_INTERVAL_MS: 3000,

  startRoomSync() {
    this.stopRoomSync();
    this.roomSyncTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.sendSignal({ type: 'sync-request' });
      }
    }, this.ROOM_SYNC_INTERVAL_MS);
  },

  stopRoomSync() {
    if (this.roomSyncTimer) {
      clearInterval(this.roomSyncTimer);
      this.roomSyncTimer = null;
    }
  },

  // NOT: renderParticipantsList() burada eskiden ikinci kez (kırık/eksik bir
  // `initials` referansıyla) tanımlıydı — JS obje literal'inde aynı anahtar iki
  // kez yazılınca sonuncusu geçerli olur, bu yüzden bu blok zaten hiç
  // çalışmıyordu (ÖLÜ KOD). Tek ve güncel tanım dosyanın altında duruyor.

  sendSignal(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  },

  async handleSignal(data) {
    const senderId = data.sender_id;

    switch (data.type) {
      case 'room-state':
        // NOT: currentEditorId, aşağıdaki renderParticipantsList() çağrısından
        // ÖNCE atanmalı — aksi halde ilk çizimde "Toplantı Sahibi" etiketi
        // henüz bilinmeyen editöre göre (varsayılana) düşer ve ancak bir
        // sonraki olayda düzelirdi.
        if (data.editor_id !== undefined) {
          this.currentEditorId = data.editor_id;
        }
        if (Array.isArray(data.users)) {
          data.users.forEach(u => {
            if (u && u.id && !u.in_lobby) {
              const uid = String(u.id);
              this.participantsMap[uid] = {
                id: uid,
                name: u.name || 'Katılımcı',
                avatar_url: u.avatar_url,
                role: u.role || 'user',
                isMicMuted: u.isMicMuted !== undefined ? Boolean(u.isMicMuted) : false,
                isCameraOff: u.isCameraOff !== undefined ? Boolean(u.isCameraOff) : false
              };
            }
          });
          this.renderParticipantsList();
          this.renderAllParticipantTiles();
          this.reflowVideoGrid();

          for (const u of data.users) {
            if (u.id && !u.in_lobby && String(u.id) !== String(this.currentUser?.id)) {
              const uStr = String(u.id);
              const isInitiator = Boolean(this.currentUser?.id && String(this.currentUser.id) < uStr);
              await this.createPeerConnection(uStr, isInitiator);
            }
          }
        }
        if (Array.isArray(data.pending_lobby_requests)) {
          data.pending_lobby_requests.forEach(req => {
            if (req) this.showLobbyApprovalNotification(req);
          });
        }
        if (data.active_screen_share && data.active_screen_share.presenter_id) {
          const presenterId = String(data.active_screen_share.presenter_id);
          // stream_id'yi kaydet ki ontrack'te isScreenStreamIdMatch çalışsın
          this.activeScreenStreamId = data.active_screen_share.stream_id || null;
          this.screenSharePresenterId = presenterId;

          if (presenterId === String(this.currentUser?.id)) {
            // BEN kendim (sayfa yenilemeden ÖNCE) ekran paylaşıyordum. Sunucu
            // F5'te paylaşımı ANINDA kesmiyor (grace period), o yüzden odanın
            // durumu hâlâ beni sunucu olarak gösteriyor — ama tarayıcı güvenliği
            // yüzünden gerçek ekran akışı (kullanıcı jesti gerektirir) sayfa
            // yenilemesi ile teknik olarak kayboldu ve otomatik geri getirilemez.
            // Kendime bir peer bağlantısı da olmayacağından ontrack asla
            // gelmeyecek — o yüzden burada beklemek yerine tek tıkla "sürdür"
            // istemi gösteriyoruz.
            this.promptResumeScreenShare();
          } else {
            const presenterStream = this.peerStreams[presenterId] || (document.getElementById(`remoteVideo_${presenterId}`)?.srcObject) || null;
            if (presenterStream) {
              this.enableScreenShareLayout(data.active_screen_share.presenter_name || 'Katılımcı', presenterStream);
            } else {
              // Stream henüz hazır değil — UI'ı gizle ama presenter ID'yi koru
              // ontrack gelince isScreenStreamIdMatch ile layout tekrar açılacak
              this.disableScreenShareLayout(true); // preservePresenterId=true
            }
          }
        } else {
          this.activeScreenStreamId = null;
          this.disableScreenShareLayout();
        }
        break;

      case 'room-sync': {
        // PERİYODİK KENDİ-KENDİNİ-ONARAN SENKRON: Sunucunun ~3sn'de bir
        // gönderdiği "authoritative" anlık görüntü. SADECE gerçek bir fark
        // varsa DOM'a dokunulur — aksi halde hiçbir şey yapılmaz (normal
        // akışta bu case'in DOM üzerinde hiçbir etkisi olmamalı).
        if (!Array.isArray(data.users)) break;
        const myId = String(this.currentUser?.id || '');

        const authoritative = {};
        data.users.forEach(u => { if (u && u.id) authoritative[String(u.id)] = u; });

        // 1) Yerelde eksik olan katılımcıları ekle (bkz. 'user-joined' yukarıda)
        for (const uid of Object.keys(authoritative)) {
          if (uid === myId || this.participantsMap[uid]) continue;
          const u = authoritative[uid];
          this.participantsMap[uid] = {
            id: uid,
            name: u.name || 'Katılımcı',
            avatar_url: u.avatar_url,
            role: u.role || 'user',
            isMicMuted: u.isMicMuted !== undefined ? Boolean(u.isMicMuted) : false,
            isCameraOff: u.isCameraOff !== undefined ? Boolean(u.isCameraOff) : false
          };
          this.renderParticipantsList();
          this.renderRemoteTile(uid);
          this.reflowVideoGrid();
          const isInitiator = Boolean(this.currentUser?.id && myId < uid);
          await this.createPeerConnection(uid, isInitiator);
          Notifications.show(`${u.name || 'Bir katılımcı'} odaya katıldı.`, 'info', 'Toplantı Katılımı');
        }

        // 2) Sunucunun artık bilmediği ama yerelde duran katılımcıları temizle
        //    — hâlâ 4sn'lik ayrılma Grace Period'unda (pendingDepartures) olanları ATLA,
        //    çift işlem/çift "ayrıldı" bildirimi olmasın.
        for (const uid of Object.keys(this.participantsMap)) {
          if (uid === myId || authoritative[uid] || this.pendingDepartures[uid]) continue;
          const leftName = this.participantsMap[uid]?.name || 'Bir katılımcı';
          delete this.participantsMap[uid];
          delete this.peerStreams[uid];
          this.removePeer(uid);
          this.renderParticipantsList();
          this.reflowVideoGrid();
          Notifications.show(`${leftName} toplantıdan ayrıldı.`, 'info', 'Ayrıldı');
        }

        // 3) Ortak katılımcılarda mikrofon/kamera uyuşmazlığı varsa yamala
        for (const uid of Object.keys(authoritative)) {
          if (uid === myId) continue;
          const local = this.participantsMap[uid];
          if (!local) continue;
          const u = authoritative[uid];
          const nextMic = u.isMicMuted !== undefined ? Boolean(u.isMicMuted) : false;
          const nextCam = u.isCameraOff !== undefined ? Boolean(u.isCameraOff) : false;
          if (local.isMicMuted !== nextMic || local.isCameraOff !== nextCam) {
            local.isMicMuted = nextMic;
            local.isCameraOff = nextCam;
            this.renderParticipantsList();
            this.renderRemoteTile(uid);
          }
        }

        // 4) Editör farkı
        if (data.editor_id !== undefined && data.editor_id !== this.currentEditorId) {
          this.currentEditorId = data.editor_id || null;
          this.renderParticipantsList();
        }

        // 5) Ekran paylaşımı farkı — SADECE gerçek fark varsa dokun; aksi halde
        //    enableScreenShareLayout gibi pahalı/yeniden-boyutlandıran
        //    fonksiyonları her 3sn'de bir tetiklemekten kaçın.
        const authPresenterId = data.active_screen_share?.presenter_id ? String(data.active_screen_share.presenter_id) : null;
        const localPresenterId = this.screenSharePresenterId ? String(this.screenSharePresenterId) : null;
        if (authPresenterId !== localPresenterId) {
          if (authPresenterId) {
            this.activeScreenStreamId = data.active_screen_share.stream_id || null;
            this.screenSharePresenterId = authPresenterId;
            if (authPresenterId === myId) {
              this.promptResumeScreenShare();
            } else {
              const presenterStream = this.peerStreams[authPresenterId] || (document.getElementById(`remoteVideo_${authPresenterId}`)?.srcObject) || null;
              if (presenterStream) {
                this.enableScreenShareLayout(data.active_screen_share.presenter_name || 'Katılımcı', presenterStream);
              } else {
                this.disableScreenShareLayout(true);
              }
            }
          } else {
            this.activeScreenStreamId = null;
            this.screenSharePresenterId = null;
            this.disableScreenShareLayout();
          }
        }
        break;
      }

      case 'user-joined':
        if (data.user_info) {
          if (data.user_info.in_lobby) {
            break; // Henüz lobide onay bekleyen katılımcı canlı odaya eklenmez
          }
          const joinedId = String(data.user_info.id || senderId);

          // Katılımcı F5 / sayfa yenileme süresi içinde (4 sn) geri geldiyse veya is_reconnect true ise sessizce bağlan
          const isReconnectingFromRefresh = Boolean(data.is_reconnect || this.pendingDepartures[joinedId]);
          if (this.pendingDepartures[joinedId]) {
            clearTimeout(this.pendingDepartures[joinedId].timerId);
            delete this.pendingDepartures[joinedId];
          }

          this.participantsMap[joinedId] = {
            id: joinedId,
            name: data.user_info.name || 'Katılımcı',
            avatar_url: data.user_info.avatar_url,
            role: data.user_info.role || 'user',
            isMicMuted: data.user_info.isMicMuted !== undefined ? Boolean(data.user_info.isMicMuted) : false,
            isCameraOff: data.user_info.isCameraOff !== undefined ? Boolean(data.user_info.isCameraOff) : false
          };
          this.renderParticipantsList();
          this.renderRemoteTile(joinedId);
          this.reflowVideoGrid();

          if (joinedId && joinedId !== String(this.currentUser?.id)) {
            const isInitiator = Boolean(this.currentUser?.id && joinedId && String(this.currentUser.id) < joinedId);
            await this.createPeerConnection(joinedId, isInitiator);
          }

          // Sayfa yenilemelerinde (F5) katıldı bildirimi düşmesini %100 engelle
          if (!isReconnectingFromRefresh) {
            Notifications.show(`${data.user_info?.name || 'Bir katılımcı'} odaya katıldı.`, 'info', 'Toplantı Katılımı');
          }
        }
        break;

      case 'user-state-update':
        if (senderId && this.participantsMap[senderId]) {
          if (data.isMicMuted !== undefined) this.participantsMap[senderId].isMicMuted = data.isMicMuted;
          if (data.isCameraOff !== undefined) this.participantsMap[senderId].isCameraOff = data.isCameraOff;
          this.renderParticipantsList();
          this.renderRemoteTile(senderId);
          this.reflowVideoGrid();
        }
        break;

      case 'lobby-join-request':
        if (data.user_info) {
          this.showLobbyApprovalNotification(data.user_info);
        }
        break;

      case 'editor-changed':
        // BUG FIX: Toplantı sahibi (editör) değiştiğinde Kişiler barındaki
        // "Toplantı Sahibi" etiketi eskiden hiç yenilenmiyordu — yeni editör
        // belli olsa bile arayüzde eski kişi sahip görünmeye devam ediyordu.
        // Artık her değişimde liste anında yeniden çiziliyor.
        this.currentEditorId = data.editor_id || null;
        this.renderParticipantsList();
        break;

      case 'editor-assigned':
        // Sunucu bu odanın tek editörünü bana (ör. eski editör ayrıldığı için)
        // devretti — bekleyen tüm lobi taleplerini şimdi bana iletiyor.
        this.currentEditorId = data.editor_id || null;
        this.renderParticipantsList();
        if (typeof Notifications !== 'undefined') {
          Notifications.show("Artık bu toplantının editörüsünüz. Katılım taleplerini siz yöneteceksiniz.", "info", "Editör Yetkisi Devredildi");
        }
        if (Array.isArray(data.pending_lobby_requests)) {
          data.pending_lobby_requests.forEach(req => {
            if (req) this.showLobbyApprovalNotification(req);
          });
        }
        break;

      // GÜVENLİK KRİTİK: Bu iki mesaj sadece o odada gerçekten ayrıcalıklı
      // olan biri sunucu tarafında doğrulandıktan SONRA bize ulaşır (bkz.
      // routes/signaling.py host-force-mic-mute/host-force-camera-off).
      // Yalnızca KAPATMA yönünde çalışırlar — açma yönü yok.
      case 'force-mic-mute':
        this.forceMuteMicRemote();
        break;

      case 'force-camera-off':
        this.forceCameraOffRemote();
        break;

      case 'video-offer':
        if (senderId) {
          let pc = await this.createPeerConnection(senderId, false);

          if (pc.signalingState !== 'stable') {
            const isPolite = Boolean(this.currentUser?.id && senderId && this.currentUser.id > senderId);
            if (!isPolite) {
              console.warn(`[WebRTC] Teklif çakışması: Kibar olmayan taraf ${senderId} gelen offer'ı göz ardı ediyor.`);
              return;
            } else {
              console.warn(`[WebRTC] Teklif çakışması: Kibar taraf yerel offer'ı geri alıyor (rollback).`);
              await pc.setLocalDescription({ type: 'rollback' }).catch(() => { });
            }
          }

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          } catch (sdpErr) {
            // BUG FIX (2-kullanıcılı canlı testte yakalandı): Karşı taraf (sender)
            // F5 yaptıysa/yeniden bağlandıysa, KENDİ RTCPeerConnection'ı sıfırdan
            // kuruluyor (hiçbir eski müzakere geçmişi yok) — ama BİZİM tarafımızdaki
            // eski peer bağlantısı henüz 'failed'/'disconnected' durumuna düşmediği
            // için (ICE/DTLS kopma tespiti saniyeler sürebilir) createPeerConnection
            // onu hâlâ canlı sanıp yeniden kullanıyordu. Karşı tarafın YENİ
            // oturumunun offer'ı, eski oturumun m-line sırasıyla (ör. ekran
            // paylaşımı ekleyen ara müzakereden dolayı) uyuşmadığından tarayıcı
            // setRemoteDescription'ı "m-line sırası uyuşmuyor" hatasıyla reddediyor
            // ve o kişiyle görüntü/ses KALICI olarak kopuk kalıyordu. Burada bunu
            // doğrudan yakalayıp eski bağlantıyı zorla kapatıp SIFIRDAN kuruyoruz.
            console.warn(`[WebRTC] Eski peer bağlantısı (${senderId}) yeni offer ile uyuşmadı, sıfırdan kuruluyor:`, sdpErr);
            try { pc.close(); } catch (e) { }
            delete this.peers[senderId];
            pc = await this.createPeerConnection(senderId, false);
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          }
          await this.processPendingCandidates(senderId);
          const answer = await pc.createAnswer();
          const optAnswer = new RTCSessionDescription({
            type: answer.type,
            sdp: this.optimizeSDP(answer.sdp)
          });
          await pc.setLocalDescription(optAnswer);

          this.sendSignal({
            type: 'video-answer',
            target_id: senderId,
            sdp: optAnswer
          });

          // KÖK NEDEN DÜZELTMESİ (yeni katılımcı/az önce yenilemiş kullanıcı
          // devam eden ekran paylaşımını göremiyor): Bu bağlantı YENİ kurulduysa
          // (ör. az önce createPeerConnection'da isScreenSharing aktifken
          // pc.addTrack(this.screenTrack) çağrıldıysa) ve gelen offer'da bu
          // track için karşılık gelen bir m-line YOKTUysa (JSEP: answer,
          // offer'daki m-line sayısını AŞAMAZ), o gönderici (sender) hâlâ hiçbir
          // m-line'a eşlenmemiş (transceiver.mid === null) kalır ve ontrack asla
          // tetiklenmez. Burada bunu tespit edip HEMEN bir takip (renegotiation)
          // offer'ı göndeririz — ekstra track(ler) böylece ikinci bir O/A turuyla
          // karşı tarafa ulaşır. (Daha önce bu senaryoyu ele alan hiçbir
          // onnegotiationneeded/takip mekanizması yoktu.)
          const hasUnnegotiatedTrack = pc.getTransceivers().some(t => t.sender && t.sender.track && !t.mid);
          if (hasUnnegotiatedTrack) {
            await this.renegotiatePeer(senderId);
          }
        }
        break;

      case 'video-answer':
        if (senderId && this.peers[senderId]) {
          const pc = this.peers[senderId];
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            await this.processPendingCandidates(senderId);
          } else {
            console.warn(`[WebRTC] Gelen video-answer göz ardı edildi. signalingState '${pc.signalingState}' durumunda.`);
          }
        }
        break;

      case 'new-ice-candidate':
        if (senderId && data.candidate) {
          const pc = this.peers[senderId];
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
              console.warn("ICE candidate ekleme hatası:", e);
            }
          } else {
            if (!this.pendingCandidates[senderId]) this.pendingCandidates[senderId] = [];
            this.pendingCandidates[senderId].push(data.candidate);
          }
        }
        break;

      case 'screen-share-request':
        if (this.isHost && data.sender_id) {
          this.showScreenShareApprovalDialog(data.sender_id, data.requester_name || 'Katılımcı');
        } else if (!this.isHost) {
          console.warn("[WebRTC] Ekran paylaşım talebi sadece toplantı yöneticisine yönlendirilir.");
        }
        break;

      case 'guest-join-request':
        if (this.isHost && data.guest_id) {
          this.showGuestApprovalDialog(data.guest_id, data.guest_name || 'Misafir Katılımcı');
        }
        break;

      case 'screen-share-request-response':
        if (String(data.target_id) === String(this.currentUser?.id)) {
          if (data.approved) {
            this.approvedScreenShare = true;
            this.showScreenShareGrantedDialog();
          } else {
            Notifications.show("Yönetici ekran paylaşımı talebinizi reddetti.", "error", "Ekran Paylaşımı İzni");
          }
        }
        break;

      case 'screen-share-start':
        this.screenSharePresenterId = String(senderId);
        this.activeScreenStreamId = data.stream_id || null;
        const presenterScreenStream = this.peerScreenStreams[senderId] || null;
        this.enableScreenShareLayout(data.presenter_name || 'Katılımcı', presenterScreenStream);
        if (senderId !== this.currentUser?.id && this.peerStreams[senderId]) {
          this.renderRemoteTile(senderId, this.peerStreams[senderId]);
        }
        Notifications.show(`${data.presenter_name || 'Bir katılımcı'} ekranını paylaşıyor.`, 'info', 'Ekran Paylaşımı');
        break;

      case 'screen-share-stop':
        this.screenSharePresenterId = null;
        this.disableScreenShareLayout();
        break;

      case 'chat-message':
        this.renderChatMessage(data);
        break;

      case 'new-note':
        this.renderLiveNote(data);
        Notifications.show(`Yönetici yeni bir not yayınladı: "${(data.content || '').slice(0, 35)}..."`, 'success', 'Toplantı Notu');
        break;

      case 'note-deleted':
        if (data.note_id) this._removeGeneralNoteFromUI(data.note_id);
        break;

      case 'user-left':
        const leavingId = String(senderId || data.user_info?.id || '');
        if (leavingId) {
          const leavingName = data.user_info?.name || this.participantsMap[leavingId]?.name || 'Bir katılımcı';

          if (data.explicit) {
            // Kullanıcı bilinçli olarak "Ayrıl" butonuna bastı -> Anında ayrılma ve bildirim
            if (this.pendingDepartures[leavingId]) {
              clearTimeout(this.pendingDepartures[leavingId].timerId);
              delete this.pendingDepartures[leavingId];
            }
            delete this.participantsMap[leavingId];
            delete this.peerStreams[leavingId];
            this.removePeer(leavingId);
            this.renderParticipantsList();
            this.reflowVideoGrid();
            Notifications.show(`${leavingName} toplantıdan ayrıldı.`, 'info', 'Ayrıldı');
          } else {
            // Sayfa yenileme (F5) veya geçici bağlantı kopması -> 4 saniyelik tolerans süresi!
            if (this.pendingDepartures[leavingId]) {
              clearTimeout(this.pendingDepartures[leavingId].timerId);
            }

            this.pendingDepartures[leavingId] = {
              userInfo: this.participantsMap[leavingId] || data.user_info,
              timerId: setTimeout(() => {
                delete this.pendingDepartures[leavingId];
                delete this.participantsMap[leavingId];
                delete this.peerStreams[leavingId];
                this.removePeer(leavingId);
                this.renderParticipantsList();
                this.reflowVideoGrid();
                Notifications.show(`${leavingName} toplantıdan ayrıldı.`, 'info', 'Ayrıldı');
              }, 4000)
            };
          }
        }
        break;

      case 'host-kick':
      case 'kicked':
      case 'guest-rejected': {
        // BUG FIX: Misafir kickliğinde/reddedildiğinde herkes gibi '/' (ana
        // sayfa/dashboard)'a atılıyordu — misafirin orada hiçbir işi yok (token'ı
        // da yok, /login'e sekiyordu). Misafirler artık kendi güvenli giriş
        // ekranına (/guest/{code}) döner; kayıtlı kullanıcılar dashboard'a.
        const isGuestUser = this.currentUser?.role === 'guest';
        Notifications.show(data.message || "Toplantı odası erişiminiz sonlandırıldı.", "danger", "Erişim Reddedildi");
        if (this.socket) {
          try { this.socket.close(4003, "Kicked/Rejected"); } catch (e) { }
        }
        this.clearChatHistory();
        setTimeout(() => {
          sessionStorage.removeItem('guest_token');
          window.location.replace(isGuestUser ? `/guest/${this.meetingCode}` : '/');
        }, 1200);
        break;
      }

      case 'meeting-ended': {
        // BUG FIX: Herkes (misafir dahil) '/reports/{id}' resmi rapor sayfasına
        // atılıyordu — bu sayfa kayıtlı kullanıcı oturumu gerektirir, misafir
        // orada oturum açmaya zorlanıp kilitleniyordu. Misafirler artık kendi
        // güvenli giriş ekranına döner (toplantı bittiği için orada da tekrar
        // giremeyeceklerdir); kayıtlı kullanıcılar resmi rapora gider.
        const isGuestUser = this.currentUser?.role === 'guest';
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (typeof Notifications !== 'undefined') {
          Notifications.show("Toplantı yönetici tarafından sonlandırıldı.", "info", "Toplantı Sona Erdi");
        }
        this.clearChatHistory();
        // BUG FIX: Misafirin geçmiş (artık geçersiz) guest_token'ı sessionStorage'da
        // kalmaya devam ediyordu — aynı sekmede aynı toplantı linkine tekrar
        // gelinirse eski/süresi dolmuş jetonla karışık bir duruma yol açabiliyordu.
        // kicked/guest-rejected akışı zaten bunu temizliyordu, burada da tutarlı
        // olsun diye ekleniyor.
        if (isGuestUser) sessionStorage.removeItem('guest_token');
        setTimeout(() => {
          window.location.href = isGuestUser ? `/guest/${this.meetingCode}` : `/reports/${this.meetingInfo?.id || ''}`;
        }, 1200);
        break;
      }
    }
  },

  showGuestApprovalDialog(guestId, guestName) {
    const existing = document.getElementById(`guestModal_${guestId}`);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = `guestModal_${guestId}`;
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center; z-index: 99999;
    `;
    modal.innerHTML = `
      <div style="background: #ffffff; border-radius: 20px; padding: 2rem; max-width: 440px; width: 90%; text-align: center; box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25); border: 1px solid #e2e8f0;">
        <div style="width: 64px; height: 64px; border-radius: 50%; background: #e0e7ff; color: #4f46e5; display: inline-flex; align-items: center; justify-content: center; font-size: 1.75rem; margin-bottom: 1.25rem; box-shadow: 0 8px 20px rgba(79, 70, 229, 0.25);">
          <i class="fas fa-user-clock"></i>
        </div>
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 800; color: #0f172a;">Misafir Katılım Talebi</h3>
        <p style="margin: 0 0 1.5rem 0; color: #64748b; font-size: 0.92rem; line-height: 1.5;">
          <strong style="color: #4f46e5; font-weight: 800;">${guestName}</strong> adlı misafir kullanıcı toplantınıza katılmak için bekleme odasında onayınızı bekliyor.
        </p>
        <div style="display: flex; gap: 0.75rem; justify-content: center;">
          <button onclick="WebRTC.respondToGuestRequest('${guestId}', false)" style="padding: 0.7rem 1.4rem; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 12px; font-weight: 700; font-size: 0.88rem; cursor: pointer; transition: all 0.2s;">Reddet</button>
          <button onclick="WebRTC.respondToGuestRequest('${guestId}', true)" style="padding: 0.7rem 1.6rem; background: linear-gradient(135deg, #10b981, #059669); color: #fff; border: none; border-radius: 12px; font-weight: 700; font-size: 0.88rem; cursor: pointer; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35); transition: all 0.2s;">Kabul Et</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    if (window.Notifications) {
      Notifications.show(`${guestName} katılım onayı bekliyor.`, 'info', 'Misafir Talebi');
    }
  },

  respondToGuestRequest(guestId, approved) {
    const modal = document.getElementById(`guestModal_${guestId}`);
    if (modal) modal.remove();

    const toast = document.getElementById('guestApprovalToast');
    if (toast) {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, -20px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
      }, 250);
    }

    this.sendSignal({
      type: 'guest-join-response',
      guest_id: guestId,
      approved: approved
    });

    if (window.Notifications) {
      Notifications.show(approved ? 'Misafir talebi kabul edildi.' : 'Misafir talebi reddedildi.', approved ? 'success' : 'warning');
    }
  },

  showScreenShareApprovalDialog(requesterId, requesterName) {
    const existing = document.getElementById(`screenShareModal_${requesterId}`);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = `screenShareModal_${requesterId}`;
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center; z-index: 99999;
    `;
    modal.innerHTML = `
      <div style="background: #ffffff; border-radius: 20px; padding: 2rem; max-width: 440px; width: 90%; text-align: center; box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25); border: 1px solid #e2e8f0;">
        <div style="width: 64px; height: 64px; border-radius: 50%; background: #e0f2fe; color: #0284c7; display: inline-flex; align-items: center; justify-content: center; font-size: 1.75rem; margin-bottom: 1.25rem;">
          <i class="fas fa-desktop"></i>
        </div>
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1.25rem; font-weight: 800; color: #0f172a;">Ekran Paylaşımı Talebi</h3>
        <p style="margin: 0 0 1.5rem 0; color: #64748b; font-size: 0.92rem; line-height: 1.5;">
          <strong style="color: #0284c7; font-weight: 800;">${requesterName}</strong> ekranını sunum yapmak üzere paylaşmak istiyor.
        </p>
        <div style="display: flex; gap: 0.75rem; justify-content: center;">
          <button onclick="WebRTC.respondToScreenShareRequest('${requesterId}', false)" style="padding: 0.7rem 1.4rem; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 12px; font-weight: 700; font-size: 0.88rem; cursor: pointer;">Reddet</button>
          <button onclick="WebRTC.respondToScreenShareRequest('${requesterId}', true)" style="padding: 0.7rem 1.6rem; background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff; border: none; border-radius: 12px; font-weight: 700; font-size: 0.88rem; cursor: pointer; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);">İzin Ver</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  respondToScreenShareRequest(requesterId, approved) {
    const modal = document.getElementById(`screenShareModal_${requesterId}`);
    if (modal) modal.remove();
    this.sendSignal({
      type: 'screen-share-request-response',
      target_id: requesterId,
      approved: approved
    });
  },

  async processPendingCandidates(remoteUserId) {
    const pc = this.peers[remoteUserId];
    if (!pc || !pc.remoteDescription) return;
    if (this.pendingCandidates[remoteUserId]) {
      const candidates = this.pendingCandidates[remoteUserId];
      delete this.pendingCandidates[remoteUserId];
      for (const cand of candidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn("Kuyruktaki ICE candidate eklenirken hata:", e);
        }
      }
    }
  },

  async renegotiatePeer(remoteUserId) {
    const pc = this.peers[remoteUserId];
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      const optOffer = new RTCSessionDescription({
        type: offer.type,
        sdp: this.optimizeSDP(offer.sdp)
      });
      await pc.setLocalDescription(optOffer);
      this.sendSignal({
        type: 'video-offer',
        target_id: remoteUserId,
        sdp: optOffer
      });
    } catch (e) {
      console.warn(`[WebRTC] Yeniden müzakere (renegotiate) hatası (${remoteUserId}):`, e);
    }
  },

  attachLocalTracksToPeer(pc) {
    if (!pc || !this.localStream) return;
    this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
    this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);
    const senders = pc.getSenders();
    this.localStream.getTracks().forEach(track => {
      const exists = senders.some(s => s.track === track || (s.track && s.track.kind === track.kind));
      if (!exists) {
        try {
          pc.addTrack(track, this.localStream);
        } catch (e) {
          console.warn("[WebRTC] Local track ekleme uyarısı:", e);
        }
      } else {
        const sender = senders.find(s => s.track && s.track.kind === track.kind);
        if (sender && sender.track !== track) {
          sender.replaceTrack(track).catch(e => console.warn("[WebRTC] replaceTrack uyarısı:", e));
        }
      }
    });
  },

  async createPeerConnection(remoteUserId, isInitiator) {
    const existingPc = this.peers[remoteUserId];
    if (existingPc) {
      // BUG FIX: Bir bağlantı 'failed'/'closed'/'disconnected' durumuna düşmüşse
      // (ör. karşı taraf F5 yaptı ve grace-period içinde sessizce yeniden bağlandığı
      // için hiçbir 'user-left'/'user-joined' sinyali gelmedi) eski nesneyi geri
      // döndürmek yerine kapatıp sıfırdan kuruyoruz. Aksi halde gelen taze bir
      // offer/answer, artık canlı olmayan bir RTCPeerConnection üzerinde işlenmeye
      // çalışılıyor ve o katılımcıyla görüntü/ses kalıcı olarak kopuk kalabiliyordu.
      const deadStates = ['failed', 'closed', 'disconnected'];
      if (deadStates.includes(existingPc.connectionState)) {
        console.warn(`[WebRTC] Ölü peer bağlantısı (${remoteUserId}, state=${existingPc.connectionState}) yeniden kuruluyor.`);
        try { existingPc.close(); } catch (e) { /* zaten kapalı olabilir */ }
        delete this.peers[remoteUserId];
      } else {
        this.attachLocalTracksToPeer(existingPc);
        return existingPc;
      }
    }

    const pc = new RTCPeerConnection(this.getIceServers());
    this.peers[remoteUserId] = pc;

    this.attachLocalTracksToPeer(pc);

    if (this.isScreenSharing && this.screenTrack) {
      if (this.screenStream) {
        pc.addTrack(this.screenTrack, this.screenStream);
      } else {
        pc.addTrack(this.screenTrack);
      }
      if (this.screenAudioTrack && this.screenStream) {
        try { pc.addTrack(this.screenAudioTrack, this.screenStream); } catch (e) { }
      }
    }

    // Kamera kapalı veya medyası olmayan istemci için video transceiver ekle
    const senders = pc.getSenders();
    const hasVideoSender = senders.some(s => s.track?.kind === 'video' || s.kind === 'video');
    if (!hasVideoSender && typeof pc.addTransceiver === 'function') {
      try {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      } catch (e) {
        console.warn("Video transceiver ekleme uyarısı:", e);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'new-ice-candidate',
          target_id: remoteUserId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Track alındı (${remoteUserId}):`, event.track.kind, event.track.label);
      const incomingStream = event.streams[0] || new MediaStream([event.track]);

      if (event.track.kind === 'video') {
        const streamId = (event.streams[0]?.id || '');
        const streamIdLower = streamId.toLowerCase();
        const trackLabel = (event.track?.label || '').toLowerCase();
        const contentHint = (event.track?.contentHint || '').toLowerCase();

        // Ekran paylaşımı tespiti — yalnızca kesin stream_id eşleşmesi, label veya presenter stream uyuşması
        const isExplicitScreen = streamIdLower.includes('screen') || streamIdLower.includes('display') ||
          trackLabel.includes('screen') || trackLabel.includes('display') ||
          trackLabel.includes('window') || trackLabel.includes('monitor') ||
          trackLabel.includes('desktop') || trackLabel.includes('entire');

        const isScreenStreamIdMatch = Boolean(this.activeScreenStreamId && streamId === this.activeScreenStreamId);
        const isPresenterScreen = Boolean(
          this.screenSharePresenterId &&
          String(remoteUserId) === String(this.screenSharePresenterId) &&
          (isScreenStreamIdMatch || isExplicitScreen || (this.peerStreams[remoteUserId] && incomingStream !== this.peerStreams[remoteUserId]))
        );

        if (isPresenterScreen || isScreenStreamIdMatch || isExplicitScreen) {
          console.log(`[WebRTC] Doğrulanmış EKRAN PAYLAŞIM akışı bağlandı (${remoteUserId})`);
          this.peerScreenStreams[remoteUserId] = incomingStream;

          const shareVid = document.getElementById('screenShareVideo');
          if (shareVid) {
            shareVid.srcObject = incomingStream;
            shareVid.muted = (String(remoteUserId) === String(this.currentUser?.id));
            shareVid.play().catch(e => console.warn('[WebRTC] Ekran paylaşımı oynatma hatası:', e));
          }

          const presenterName = this.participantsMap[remoteUserId]?.name || 'Katılımcı';
          this.screenSharePresenterId = String(remoteUserId);
          this.enableScreenShareLayout(presenterName, incomingStream);

          // Sunucunun kamera kartını da üst şeritte web kamerası ile güncelle
          if (this.peerStreams[remoteUserId]) {
            this.renderRemoteTile(remoteUserId, this.peerStreams[remoteUserId]);
          }
          return;
        }

        // Normal Kamera Akışı
        console.log(`[WebRTC] Doğrulanmış KAMERA akışı bağlandı (${remoteUserId})`);
        this.peerStreams[remoteUserId] = incomingStream;
        // Güvenlik & Tek Doğruluk Kaynağı: Katılımcının kamerasının açık/kapalı durumu 
        // sinyalleşme ile kontrol edilir. Gelen WebRTC parçası isCameraOff durumunu ezemez.
        this.renderRemoteTile(remoteUserId, incomingStream);
        return;
      }

      if (event.track.kind === 'audio') {
        const audioEl = document.getElementById(`remoteAudio_${remoteUserId}`);
        if (audioEl) {
          audioEl.srcObject = incomingStream;
          if (this.selectedSpeakerId && typeof audioEl.setSinkId === 'function') {
            audioEl.setSinkId(this.selectedSpeakerId).catch(() => { });
          }
          audioEl.play().catch(e => console.warn('[WebRTC] Uzaktan ses oynatılamadı:', e));
        }
      }
    };

    // Connection state handler (Preserve DOM tile during F5 refresh grace period)
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        if (!this.pendingDepartures[String(remoteUserId)]) {
          this.removePeer(remoteUserId);
        }
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        const optOffer = new RTCSessionDescription({
          type: offer.type,
          sdp: this.optimizeSDP(offer.sdp)
        });
        await pc.setLocalDescription(optOffer);
        this.sendSignal({
          type: 'video-offer',
          target_id: remoteUserId,
          sdp: optOffer
        });
      } catch (e) {
        console.warn(`[WebRTC] Offer oluşturma hatası (${remoteUserId}):`, e);
      }
    }

    return pc;
  },

  renderLocalTile() {
    const isScreenShareActive = (document.getElementById('screenShareArea')?.style.display === 'flex');
    const activeContainer = isScreenShareActive
      ? document.getElementById('topCarouselBar')
      : document.getElementById('videoGrid');

    if (!activeContainer) return;

    let tile = document.getElementById('localParticipantTile');
    const isPinned = (this.pinnedTileId === 'localParticipantTile');

    if (!tile) {
      tile = document.createElement('div');
      tile.id = 'localParticipantTile';
      tile.className = `participant-tile local-tile ${isPinned ? 'pinned-tile' : ''}`;
      activeContainer.appendChild(tile);
    } else {
      tile.className = `participant-tile local-tile ${isPinned ? 'pinned-tile' : ''}`;
      if (tile.parentElement !== activeContainer) {
        activeContainer.appendChild(tile);
      }
    }

    const name = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Bedirhan Dikmen';
    const initials = `${(this.currentUser?.first_name?.[0] || 'B')}${(this.currentUser?.last_name?.[0] || 'D')}`.toUpperCase();
    const avatarUrl = this.currentUser?.avatar_url;

    tile.innerHTML = `
      <video id="localVideo" autoplay playsinline muted style="display: ${this.isCameraOff ? 'none' : 'block'}; position: absolute; top:0; left:0; width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1);"></video>
      <div id="localAvatar" style="display: ${this.isCameraOff ? 'flex' : 'none'}; width: 76px; height: 76px; border-radius: 50%; background: #5b5fc7; color: #fff; font-size: 2rem; font-weight: 800; border: 2px solid #ffffff; box-shadow: 0 4px 15px rgba(91, 95, 199, 0.25);">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : initials}
      </div>
      
      <!-- TOP-RIGHT 3-DOTS CONTEXT MENU BUTTON (bkz. WebRTC.openTileMenu — menü artık
           document.body'de bağımsız "floating" katman olarak açılıyor, kartın kendi
           overflow:hidden'ından etkilenmiyor) -->
      <button class="tile-more-btn" onclick="WebRTC.openTileMenu(event, 'local')" title="Kart Seçenekleri" style="position: absolute; top: 0.65rem; right: 0.65rem; background: rgba(0,0,0,0.5); color: #fff; border: none; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; z-index: 15; backdrop-filter: blur(4px);">
        <i class="fas fa-ellipsis-v" style="font-size: 0.8rem;"></i>
      </button>

      <!-- TRANSLUCENT DARK OVERLAY PILL WITH WHITE TEXT AT BOTTOM-LEFT -->
      <div class="tile-overlay-pill">
        <strong style="color: #ffffff; font-weight: 700;">${name} (Siz)</strong>
        <i class="fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${this.isMicMuted ? '#f87171' : '#ffffff'}; font-size: 0.8rem;"></i>
      </div>
    `;

    const videoEl = document.getElementById('localVideo');
    if (videoEl && this.localStream) {
      videoEl.srcObject = this.localStream;
      videoEl.style.display = this.isCameraOff ? 'none' : 'block';
    }
    this.reflowActiveLayout();
  },

  renderRemoteTile(remoteUserId, stream = null) {
    const isScreenShareActive = (document.getElementById('screenShareArea')?.style.display === 'flex');
    const activeContainer = isScreenShareActive
      ? document.getElementById('topCarouselBar')
      : document.getElementById('videoGrid');

    if (!activeContainer) return;

    const info = this.participantsMap[remoteUserId] || { name: `Katılımcı (${remoteUserId.slice(0, 5)})` };
    const name = info.name || 'Katılımcı';
    const initials = (name[0] || 'K').toUpperCase();
    const avatarUrl = info.avatar_url;
    const isCameraOff = Boolean(info.isCameraOff);
    const isHostUser = Boolean(this.meetingInfo?.created_by && remoteUserId && String(remoteUserId) === String(this.meetingInfo.created_by));

    let tile = document.getElementById(`remoteTile_${remoteUserId}`);
    const isPinned = (this.pinnedTileId === `remoteTile_${remoteUserId}`);
    const currentVol = (this.remoteVolumes[remoteUserId] ?? 1.0);
    const isLocalMuted = !!this.remoteMuted[remoteUserId];
    const isSpeaking = !!info.isSpeaking;

    if (!tile) {
      tile = document.createElement('div');
      tile.id = `remoteTile_${remoteUserId}`;
      tile.className = `participant-tile ${isPinned ? 'pinned-tile' : ''} ${isSpeaking ? 'active-speaker' : ''}`;
      activeContainer.appendChild(tile);
    } else {
      tile.className = `participant-tile ${isPinned ? 'pinned-tile' : ''} ${isSpeaking ? 'active-speaker' : ''}`;
      if (tile.parentElement !== activeContainer) {
        activeContainer.appendChild(tile);
      }
    }

    tile.innerHTML = `
      <audio id="remoteAudio_${remoteUserId}" autoplay playsinline style="position: absolute; opacity: 0; pointer-events: none; width: 1px; height: 1px; z-index: -1;"></audio>
      <video id="remoteVideo_${remoteUserId}" autoplay playsinline style="display: ${isCameraOff ? 'none' : 'block'}; position: absolute; top:0; left:0; width: 100%; height: 100%; object-fit: cover;"></video>
      <div id="remoteAvatar_${remoteUserId}" style="display: ${isCameraOff ? 'flex' : 'none'}; width: 76px; height: 76px; border-radius: 50%; background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); color: #5b5fc7; border: 2px solid #ffffff; font-size: 2rem; font-weight: 800; box-shadow: 0 4px 15px rgba(91, 95, 199, 0.15);">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : initials}
      </div>
      
      <!-- TOP-LEFT ACTIVE SPEAKER PILL BADGE -->
      ${isSpeaking ? `
        <div class="active-speaker-badge">
          <div class="sound-wave-bars"><span></span><span></span><span></span></div>
          Konuşan: ${name}
        </div>
      ` : ''}

      <!-- TOP-RIGHT 3-DOTS CONTEXT MENU BUTTON (bkz. WebRTC.openTileMenu — menü artık
           document.body'de bağımsız "floating" katman olarak açılıyor, kartın kendi
           overflow:hidden'ından etkilenmiyor) -->
      <button class="tile-more-btn" onclick="WebRTC.openTileMenu(event, '${remoteUserId}')" title="Katılımcı Seçenekleri" style="position: absolute; top: 0.65rem; right: 0.65rem; background: rgba(0,0,0,0.5); color: #fff; border: none; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; z-index: 15; backdrop-filter: blur(4px);">
        <i class="fas fa-ellipsis-v" style="font-size: 0.8rem;"></i>
      </button>

      <!-- TRANSLUCENT DARK OVERLAY PILL WITH WHITE TEXT AT BOTTOM-LEFT -->
      <div class="tile-overlay-pill">
        <strong style="color: #ffffff; font-weight: 700;">${name}</strong>
        <i class="fas ${info.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${info.isMicMuted ? '#f87171' : '#ffffff'}; font-size: 0.8rem;"></i>
      </div>
    `;

    const streamToUse = stream || this.peerStreams[remoteUserId];
    if (streamToUse) {
      const audioEl = document.getElementById(`remoteAudio_${remoteUserId}`);
      if (audioEl) {
        if (audioEl.srcObject !== streamToUse) {
          audioEl.srcObject = streamToUse;
        }
        audioEl.volume = currentVol;
        audioEl.muted = isLocalMuted;
        // BUG FIX: tile.innerHTML her yeniden çizimde bu <audio> elemanını
        // SIFIRDAN üretiyor (bkz. yukarıdaki tile.innerHTML ataması) — daha
        // önce switchAudioOutput ile seçilmiş hoparlör tercihi kaybolup sessizce
        // varsayılan çıkışa dönüyordu. Burada her (yeniden) çizimde tekrar uygulanır.
        if (this.selectedSpeakerId && typeof audioEl.setSinkId === 'function') {
          audioEl.setSinkId(this.selectedSpeakerId).catch(() => { });
        }
        audioEl.play().catch(e => console.warn(`[WebRTC] Uzaktan ses (${remoteUserId}) oynatılamadı:`, e));
      }

      const videoEl = document.getElementById(`remoteVideo_${remoteUserId}`);
      if (videoEl) {
        if (videoEl.srcObject !== streamToUse) {
          videoEl.srcObject = streamToUse;
        }
        videoEl.play().catch(e => console.warn(`[WebRTC] Uzaktan video (${remoteUserId}) oynatılamadı:`, e));
      }
    }

    this.reflowActiveLayout();
  },

  renderAllParticipantTiles() {
    Object.keys(this.participantsMap).forEach(uid => {
      if (uid && uid !== this.currentUser?.id) {
        this.renderRemoteTile(uid);
      }
    });
    this.reflowActiveLayout();
  },

  setRemoteStream(remoteUserId, stream) {
    const videoEl = document.getElementById(`remoteVideo_${remoteUserId}`);
    if (videoEl) {
      videoEl.srcObject = stream;
    } else {
      this.peerStreams[remoteUserId] = stream;
      this.renderRemoteTile(remoteUserId, stream);
    }
  },

  enableScreenShareLayout(presenterName, stream, secondStream = null, secondPresenterName = null) {
    const shareArea = document.getElementById('screenShareArea');
    const grid = document.getElementById('videoGrid');
    const topBar = document.getElementById('topCarouselBar');
    const headerShareBadge = document.getElementById('headerScreenShareBadge');

    if (!shareArea || !grid) return;

    // 1. Izgara ve Ekran Sahnesinin Kesin Dikey Ayrıştırılması (X ekseninde yan yana durması kesinlikle engellenir)
    grid.style.setProperty('display', 'none', 'important');
    shareArea.style.setProperty('display', 'flex', 'important');
    if (topBar) topBar.style.setProperty('display', 'flex', 'important');
    if (headerShareBadge) headerShareBadge.style.display = 'inline-flex';

    // 2. Tüm katılımcı kartlarını (lokal + uzaktan) üst şeride (topCarouselBar) taşı
    const tiles = document.querySelectorAll('.participant-tile:not(.overflow-tile)');
    tiles.forEach(tile => {
      if (topBar && tile.parentElement !== topBar) {
        topBar.appendChild(tile);
      }
    });

    this.reflowTopCarouselBar();

    // Video metadata'sı bu noktada zaten hazır olabilir (loadedmetadata bir
    // daha tetiklenmeyebilir) — kart boyutunu hemen ve bir sonraki frame'de
    // (konteyner gerçek boyutuna oturduktan sonra) tekrar hesapla.
    this._fitScreenShareFrame();
    requestAnimationFrame(() => this._fitScreenShareFrame());

    const presenterEl = document.getElementById('screenSharePresenterName');
    if (presenterEl) presenterEl.textContent = `${presenterName} ekranını paylaşıyor`;

    const isPresenterView = String(this.screenSharePresenterId) === String(this.currentUser?.id);

    const stopBtn = document.getElementById('btnStopMyShareOverlay');
    if (stopBtn) {
      stopBtn.style.display = isPresenterView ? 'inline-block' : 'none';
    }

    // BUG FIX: Paylaşımı yapan kişi kendi ekranının (yerel önizlemesinin) sesini
    // kontrol eden üç-nokta menüsünü hiç görmemeli — bu ANLAMSIZ (kendi sesini
    // kendine sessize almak) ve karışıklığa yol açıyordu. İzleyen diğer
    // katılımcılar için menü olduğu gibi (ses seviyesi/sessize alma) kalır.
    const menuBtn = document.getElementById('btnScreenShareMenu');
    if (menuBtn) menuBtn.style.display = isPresenterView ? 'none' : 'flex';

    // Kartın hızlı ses aç/kapa butonu da aynı nedenle sadece izleyicilere gösterilir.
    const audioToggleBtn = document.getElementById('btnScreenShareAudioToggle');
    if (audioToggleBtn) audioToggleBtn.style.display = isPresenterView ? 'none' : 'flex';

    const tile2 = document.getElementById('screenShareTile_2');
    if (secondStream && tile2) {
      tile2.style.display = 'block';
      const shareVid2 = document.getElementById('screenShareVideo2');
      if (shareVid2) {
        shareVid2.srcObject = secondStream;
        shareVid2.play().catch(e => console.warn(e));
      }
      if (presenterEl) presenterEl.textContent = `${presenterName} ve ${secondPresenterName || '2. Kullanıcı'} ekranlarını paylaşıyor`;
    } else if (tile2) {
      tile2.style.display = 'none';
    }

    if (!stream && this.screenSharePresenterId) {
      stream = this.peerScreenStreams[this.screenSharePresenterId] || null;
    }

    const shareVid = document.getElementById('screenShareVideo');
    if (shareVid && stream) {
      // BUG FIX: enableScreenShareLayout() paylaşım süresince (ör. periyodik
      // senkron/yeniden render, kart yeniden boyutlandırma) birden çok kez
      // tetiklenebiliyor. Öncesinde her çağrıda .muted KOŞULSUZ sıfırlanıyordu
      // — izleyici karttaki yeni ses butonuyla veya menüden sessize alsa bile,
      // bir sonraki tetiklemede sessiz durumu SESSİZCE geri açılıyordu (kullanıcı
      // tercihini kaybettiği, "bug" gibi hissettiren bir davranış). Artık
      // varsayılan sessiz/açık durumu SADECE gerçekten YENİ bir stream
      // bağlandığında uygulanır; aynı stream için tekrar çağrılırsa izleyicinin
      // az önce seçtiği ses tercihi olduğu gibi korunur.
      const isNewStream = shareVid.srcObject !== stream;
      if (isNewStream) {
        shareVid.muted = (this.screenSharePresenterId === this.currentUser?.id);
        shareVid.srcObject = stream;
      }
      shareVid.play().catch(e => console.warn(e));
    }
    this._syncScreenShareAudioUI();
  },

  toggleScreenShareAudio() {
    const shareVid = document.getElementById('screenShareVideo');
    if (shareVid) {
      shareVid.muted = !shareVid.muted;
      if (!shareVid.muted && shareVid.volume === 0) shareVid.volume = 1;
      this._syncScreenShareAudioUI();
    }
  },

  setScreenShareVolume(value) {
    const vol = parseFloat(value) / 100;
    const shareVid = document.getElementById('screenShareVideo');
    if (shareVid) {
      shareVid.volume = vol;
      shareVid.muted = (vol === 0);
    }
    this._syncScreenShareAudioUI();
  },

  // Ekran paylaşımı üç-nokta menüsündeki (ve varsa üstteki eski göstergedeki)
  // ses simgesi/etiketini gerçek <video> durumuna göre günceller.
  _syncScreenShareAudioUI() {
    const shareVid = document.getElementById('screenShareVideo');
    if (!shareVid) return;
    const icon = document.getElementById('iconShareAudio');
    if (icon) {
      icon.className = shareVid.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
      icon.style.color = shareVid.muted ? '#f87171' : '#ffffff';
    }
    const label = document.getElementById('screenShareVolumeLabel');
    if (label) label.textContent = `${Math.round((shareVid.muted ? 0 : shareVid.volume) * 100)}%`;

    // Karttaki hızlı ses aç/kapa butonunun ikonu da aynı gerçek duruma göre senkron kalsın.
    const quickIcon = document.getElementById('btnScreenShareAudioToggleIcon');
    if (quickIcon) {
      quickIcon.className = shareVid.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
    }
    const quickBtn = document.getElementById('btnScreenShareAudioToggle');
    if (quickBtn) quickBtn.title = shareVid.muted ? 'Ekran Paylaşımı Sesini Aç' : 'Ekran Paylaşımı Sesini Kapat';
  },

  // Ekran paylaşımı kartının üç-nokta menüsü: ses seviyesi/sessize alma +
  // tam ekran — eskiden her zaman açık duran hover ikon satırının yerini
  // aldı, diğer video kartlarıyla (openTileMenu) tutarlı hale getirildi.
  openScreenShareMenu(event) {
    const shareVid = document.getElementById('screenShareVideo');
    const isMuted = shareVid ? shareVid.muted : false;
    const volPercent = shareVid ? Math.round((isMuted ? 0 : shareVid.volume) * 100) : 100;

    const html = `
      <div class="wrtc-menu-label">EKRAN PAYLAŞIMI SESİ</div>
      <div class="wrtc-menu-volume-row">
        <input type="range" min="0" max="100" value="${volPercent}" oninput="WebRTC.setScreenShareVolume(this.value)">
        <span id="screenShareVolumeLabel">${volPercent}%</span>
      </div>
      <button class="menu-item" onclick="WebRTC.toggleScreenShareAudio(); WebRTC.closeFloatingMenu();">
        <i class="fas ${isMuted ? 'fa-volume-up' : 'fa-volume-mute'}" style="color:#f43f5e;"></i> ${isMuted ? 'Sesi Aç' : 'Sessize Al'}
      </button>
      <div class="wrtc-menu-divider"></div>
      <button class="menu-item" onclick="WebRTC.toggleFullscreen('screenShareArea'); WebRTC.closeFloatingMenu();">
        <i class="fas fa-expand-arrows-alt" style="color:#8b5cf6;"></i> Tam Ekran
      </button>
    `;

    this.openFloatingMenu(event, html, { anchorEl: event?.currentTarget });
  },

  // BUG FIX: Ekran paylaşımı kartının çerçevesi (`#screenShareCardFrame`)
  // sabit 16:9 oranla konteynerin TAMAMINI dolduruyordu (bkz. style.css'teki
  // eski `!important` width/height:100% kuralı, artık kaldırıldı). Paylaşılan
  // ekran/pencere 16:9 olmadığında, video `object-fit:contain` ile küçülüp
  // ortalanıyor ama kartın kendi (neredeyse siyah) arka planı geniş "boşluk"
  // olarak görünüyordu. Artık video meta verisi (gerçek videoWidth/Height)
  // geldiğinde, konteynerin gerçek boyutu içinde "contain" mantığıyla TAM
  // OTURAN piksel genişlik/yükseklik hesaplanıp karta doğrudan uygulanıyor —
  // kartın kendisi artık gerçek içerikle birebir aynı orana sahip, gereksiz
  // siyah alan kalmıyor, video hiçbir şekilde kırpılmıyor (taşma da yok).
  _fitScreenShareFrame() {
    const video = document.getElementById('screenShareVideo');
    const frame = document.getElementById('screenShareCardFrame');
    const container = document.getElementById('screenShareTile_1');
    if (!video || !frame || !container) return;
    if (!video.videoWidth || !video.videoHeight) return;

    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const containerRatio = rect.width / rect.height;
    const videoRatio = video.videoWidth / video.videoHeight;

    let finalWidth, finalHeight;
    if (videoRatio > containerRatio) {
      // Video konteynerden daha "geniş" oranlı -> genişlik konteynere tam otursun
      finalWidth = rect.width;
      finalHeight = rect.width / videoRatio;
    } else {
      // Video konteynerden daha "dar/uzun" oranlı -> yükseklik konteynere tam otursun
      finalHeight = rect.height;
      finalWidth = rect.height * videoRatio;
    }

    frame.style.setProperty('width', `${Math.floor(finalWidth)}px`, 'important');
    frame.style.setProperty('height', `${Math.floor(finalHeight)}px`, 'important');
  },

  _setupScreenShareAspectRatioSync() {
    const video = document.getElementById('screenShareVideo');
    if (!video || video._aspectSyncBound) return;
    video._aspectSyncBound = true;

    const apply = () => this._fitScreenShareFrame();
    video.addEventListener('loadedmetadata', apply);
    // Bazı tarayıcılar paylaşılan pencere yeniden boyutlandırıldığında bu
    // olayı tetikler (nadir ama zararsız bir ek güvence).
    video.addEventListener('resize', apply);

    let resizeDebounce = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(apply, 120);
    });
  },

  disableScreenShareLayout(preservePresenterId = false) {
    const shareArea = document.getElementById('screenShareArea');
    const grid = document.getElementById('videoGrid');
    const topBar = document.getElementById('topCarouselBar');
    const headerShareBadge = document.getElementById('headerScreenShareBadge');

    if (!shareArea || !grid) return;

    shareArea.style.setProperty('display', 'none', 'important');
    // BUG FIX: Burada eskiden 'grid' set ediliyordu — bu, yeni dinamik ızgara
    // sisteminin (bkz. reflowVideoGrid/computeOptimalGridLayout) dayandığı
    // `display:flex; flex-wrap:wrap` modeliyle çakışıp her katılımcı kartının
    // (grid-template-columns hiç tanımlı olmadığı için) 0x0 render edilmesine,
    // yani odaya girer girmez TÜM kartların görünmez olmasına sebep oluyordu.
    grid.style.setProperty('display', 'flex', 'important');
    if (topBar) topBar.style.setProperty('display', 'none', 'important');
    if (headerShareBadge) headerShareBadge.style.display = 'none';

    const shareVid = document.getElementById('screenShareVideo');
    if (shareVid) shareVid.srcObject = null;

    const shareVid2 = document.getElementById('screenShareVideo2');
    if (shareVid2) shareVid2.srcObject = null;

    const tile2 = document.getElementById('screenShareTile_2');
    if (tile2) tile2.style.display = 'none';

    // Katılımcı kartlarını ana grid alanına (videoGrid) geri taşı
    const tiles = document.querySelectorAll('.participant-tile:not(.overflow-tile)');
    tiles.forEach(tile => {
      if (grid && tile.parentElement !== grid) {
        grid.appendChild(tile);
      }
    });

    if (!preservePresenterId) {
      this.screenSharePresenterId = null;
    }
    this.isScreenSharing = false;
    this.updateScreenShareButtonState(false);

    this.renderLocalTile();
    this.renderAllParticipantTiles();
    this.reflowVideoGrid();
  },

  reflowActiveLayout() {
    const isScreenShareActive = (document.getElementById('screenShareArea')?.style.display === 'flex');
    if (isScreenShareActive) {
      this.reflowTopCarouselBar();
    } else {
      this.reflowVideoGrid();
    }
  },

  reflowTopCarouselBar() {
    // BUG FIX: Bu fonksiyon önceden 6'dan fazla katılımcıda geri kalanları
    // GİZLEYİP yerine tıklanabilir bir "+N Daha fazla" yer tutucu kartı
    // koyuyordu — yani ekran paylaşımı sırasında 6'dan fazla kişi olduğunda
    // bazı katılımcılar üst şeritte HİÇ görünmüyordu. Artık şerit alçaltılmış
    // yüksekliğiyle ve yatay kaydırma çubuğuyla (bkz. style.css
    // .top-carousel-bar `overflow-x: auto`) TÜM katılımcı kartlarını gösteriyor;
    // kimse gizlenmiyor, gerekirse kaydırılarak herkese ulaşılabiliyor.
    const topBar = document.getElementById('topCarouselBar');
    if (!topBar || topBar.style.display === 'none') return;

    const existingOverflow = topBar.querySelector('.overflow-tile');
    if (existingOverflow) existingOverflow.remove();

    const tiles = Array.from(topBar.querySelectorAll('.participant-tile:not(.overflow-tile)'));
    tiles.forEach(tile => tile.style.display = 'flex');

    // Kartlar konteynere sığdığı sürece ORTALI dizilsin (bkz. style.css
    // .top-carousel-bar); ancak taşıp yatay kaydırma gerektiğinde SOLA
    // dayalı dizilime geçilsin — aksi halde kullanıcı ilk kartlara ulaşmak
    // için hem sağa hem sola kaydırmak zorunda kalırdı. Genişlik ölçümü,
    // tarayıcı yeni eklenen/gösterilen kartların layout'unu oturttuktan
    // sonra (bir sonraki frame'de) doğru sonuç verir.
    requestAnimationFrame(() => {
      const isOverflowing = topBar.scrollWidth > topBar.clientWidth + 1;
      topBar.classList.toggle('carousel-overflowing', isOverflowing);
    });
  },

  // ==========================================================================
  // SMART GALLERY (AKILLI GALERİ) MOTORU V1.0
  // ==========================================================================
  smartGalleryState: {
    lastSpokenMap: {},    // userId -> timestamp (ms) when last spoke
    cameraStateMap: {},   // userId -> timestamp (ms) when camera turned on
    audioAnalyzers: {},   // userId -> AudioContext/Analyser
  },

  updateParticipantSpeakingState(userId, isSpeaking) {
    if (!this.participantsMap[userId]) {
      this.participantsMap[userId] = {};
    }
    this.participantsMap[userId].isSpeaking = isSpeaking;
    if (isSpeaking) {
      this.smartGalleryState.lastSpokenMap[userId] = Date.now();
    }

    // Highlight tile border
    const tileId = (userId === this.currentUser?.id || userId === 'local') ? 'localParticipantTile' : `remoteTile_${userId}`;
    const tile = document.getElementById(tileId);
    if (tile) {
      if (isSpeaking) {
        tile.classList.add('active-speaker');
      } else {
        tile.classList.remove('active-speaker');
      }
    }

    // Trigger Smart Gallery Re-sorting
    this.reflowActiveLayout();
  },

  getParticipantPriorityScore(userId) {
    const now = Date.now();
    let score = 0;

    // 1. Local user / Self view always prioritized in grid
    if (userId === this.currentUser?.id || userId === 'local') {
      score += 100000;
    }

    // 2. Pinned tile gets top priority
    const tileId = (userId === this.currentUser?.id || userId === 'local') ? 'localParticipantTile' : `remoteTile_${userId}`;
    if (this.pinnedTileId === tileId) {
      score += 50000;
    }

    // 3. Currently Speaking (Active Speaker) -> Highest dynamic priority
    const isSpeaking = (userId === this.currentUser?.id || userId === 'local') ? !this.isMicMuted : !!this.participantsMap[userId]?.isSpeaking;
    if (isSpeaking) {
      score += 20000;
    }

    // 4. Recently Spoken (within last 30 seconds) -> Exponential/Linear decay
    const lastSpoken = this.smartGalleryState.lastSpokenMap[userId] || 0;
    const secondsAgo = (now - lastSpoken) / 1000;
    if (secondsAgo <= 30) {
      score += (30 - secondsAgo) * 100; // max +3000 pts
    }

    // 5. Camera On
    const isCameraOff = (userId === this.currentUser?.id || userId === 'local') ? this.isCameraOff : (this.participantsMap[userId]?.isCameraOff !== false);
    if (!isCameraOff) {
      score += 1000;
    }

    // 6. Tie-breaker: camera toggled timestamp
    const camTime = this.smartGalleryState.cameraStateMap[userId] || 0;
    score += (camTime / 100000000000);

    return score;
  },

  gridCurrentPage: 1,
  // Gerçek konferans uygulamalarındaki (Zoom ~25, Teams/Meet büyük galeri ~49)
  // sayfa başı kart sayısına yakın bir değer: aynı anda decode edilen video
  // sayısını sınırlayarak 24+ katılımcılı toplantılarda donmayı/kasmayı önler.
  gridTilesPerPage: 24,
  // Kartlar arası boşluk (px). İnce bir ayraç çizgisi hissi için düşük
  // tutuluyor; 0 yapılırsa kartlar tamamen bitişik (dip dibe) görünür.
  GRID_GAP_PX: 6,

  nextGridPage() {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;
    const allTiles = Array.from(grid.querySelectorAll('.participant-tile:not(.overflow-tile)'));
    const totalPages = Math.ceil(allTiles.length / this.gridTilesPerPage) || 1;
    if (this.gridCurrentPage < totalPages) {
      this.gridCurrentPage++;
      this.reflowVideoGrid();
    }
  },

  prevGridPage() {
    if (this.gridCurrentPage > 1) {
      this.gridCurrentPage--;
      this.reflowVideoGrid();
    }
  },

  /**
   * Gerçek konferans uygulamalarının (Zoom/Meet/Teams) kullandığı "alanı
   * maksimize eden ızgara" algoritması. Sabit "2 kişi böyle görünsün, 4 kişi
   * şöyle" kırılma noktaları YERİNE: verilen container boyutu ve kart sayısı
   * için, 16:9 en-boy oranını koruyarak mümkün olan EN BÜYÜK kart boyutunu
   * veren sütun sayısını dener dener bulur. Her olası sütun sayısında hem
   * "genişliğe göre" hem "yüksekliğe göre" olası kart boyutu hesaplanır,
   * taşmayı önlemek için küçük olan seçilir; en büyük alanı (width*height)
   * veren seçenek kazanır. Bu tek algoritma; 1, 2, 3, 4, 8, 24+ katılımcı
   * dahil HER senaryoyu (ayrı ayrı özel durum kodu yazmadan) doğru çözer.
   */
  computeOptimalGridLayout(containerWidth, containerHeight, tileCount, aspectRatio = 16 / 9, gap = this.GRID_GAP_PX) {
    if (tileCount <= 0 || containerWidth <= 0 || containerHeight <= 0) {
      return { cols: 1, rows: 1, tileWidth: Math.max(containerWidth, 0), tileHeight: Math.max(containerHeight, 0) };
    }

    let best = null;
    for (let cols = 1; cols <= tileCount; cols++) {
      const rows = Math.ceil(tileCount / cols);

      const widthByCols = (containerWidth - gap * (cols - 1)) / cols;
      const heightByCols = widthByCols / aspectRatio;

      const heightByRows = (containerHeight - gap * (rows - 1)) / rows;
      const widthByRows = heightByRows * aspectRatio;

      // İkisinden hangisi daha küçükse onu kullan (diğer eksende taşma olmasın)
      const tileWidth = heightByCols <= heightByRows ? widthByCols : widthByRows;
      const tileHeight = heightByCols <= heightByRows ? heightByCols : heightByRows;

      if (tileWidth <= 0 || tileHeight <= 0) continue;

      const area = tileWidth * tileHeight;
      if (!best || area > best.area) {
        best = { cols, rows, tileWidth, tileHeight, area };
      }
    }

    // UX İSTİSNASI: 2 katılımcı için saf alan-maksimizasyonu, container biraz
    // "kare"ye yakınsa iki kartı alt alta (1 sütun) dizmeyi tercih edebiliyor.
    // Zoom/Meet/Teams dahil TÜM gerçek toplantı uygulamaları 2 kişiyi her
    // zaman yan yana gösterir (yüz yüze konuşma hissi); container gerçekten
    // dikey (portre, ör. telefon) olmadıkça bu yerleşik beklentiyi koruyoruz.
    if (tileCount === 2 && containerWidth >= containerHeight * 0.9) {
      const gap1 = gap;
      const sideBySideWidth = (containerWidth - gap1) / 2;
      const sideBySideHeight = sideBySideWidth / aspectRatio;
      if (sideBySideHeight <= containerHeight && sideBySideWidth > 0) {
        best = { cols: 2, rows: 1, tileWidth: sideBySideWidth, tileHeight: sideBySideHeight, area: sideBySideWidth * sideBySideHeight };
      }
    }

    return best || { cols: 1, rows: tileCount, tileWidth: containerWidth, tileHeight: containerWidth / aspectRatio };
  },

  reflowVideoGrid() {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    // GERÇEK KÖK NEDEN (tam ekran çalışmıyordu): Bir kart fullscreen'e
    // alındığında toggleFullscreen() genişlik/yüksekliğini %100'e zorluyordu,
    // AMA #videoGrid'i izleyen ResizeObserver (bkz. setupResponsiveGridObserver)
    // fullscreen'e geçişin tetiklediği boyut değişikliğini "gerçek" bir
    // yeniden boyutlandırma sanıp ~80ms sonra reflowVideoGrid()'i tekrar
    // çağırıyor, bu da fullscreen'deki kartın boyutunu ESKİ küçük ızgara
    // boyutuna GERİ YAZIYORDU (neredeyse anında, göze "çalışmıyor" gibi
    // görünüyordu). Fullscreen aktifken ızgarayı hiç yeniden düzenleme —
    // çıkışta (fullscreenchange dinleyicisi) zaten açıkça yeniden çağrılıyor.
    if (document.fullscreenElement) return;

    // Eski sabit "grid-1..grid-16" sınıf/CSS sistemi kaldırıldı (bkz.
    // style.css) — iki farklı, birbiriyle çakışan katmanlama seti aynı
    // seçicilere yazıyordu; bu da katılımcı sayısına göre kartların rastgele
    // küçülmesine, gereksiz boşluğa ve bazı senaryolarda (2 katılımcı) video
    // akışının hiç görünmemesine sebep oluyordu. Artık tüm boyutlandırma
    // burada, container'ın gerçek anlık ölçüsüne göre hesaplanıyor.
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';

    const existingOverflow = grid.querySelector('.overflow-tile');
    if (existingOverflow) existingOverflow.remove();

    const allTiles = Array.from(grid.querySelectorAll('.participant-tile:not(.overflow-tile)'));
    const totalCount = allTiles.length;
    const paginationControls = document.getElementById('gridPaginationControls');
    const pageIndicator = document.getElementById('gridPageIndicator');

    if (totalCount === 0) return;

    // FLIP animasyonu — 1. adım "First": kartların yeniden sıralama/boyutlandırma
    // ÖNCESİ konum ve boyutlarını kaydet. CSS'in `transition: width, height`
    // özelliği tek başına yetersizdi: flex-wrap içinde bir kartın SIRASI/KONUMU
    // değiştiğinde (biri katılıp ayrılınca veya sohbet paneli açılıp kapanınca)
    // tarayıcı bunu "geçiş" olarak değil anlık bir yer değiştirme olarak
    // uyguluyor — kartlar sert/küt bir şekilde zıplıyordu. FLIP (First-Last-
    // Invert-Play) tekniğiyle: eski konumu ölç, yeni yerleşimi uygula, aradaki
    // farkı GPU-hızlandırmalı bir `transform` ile anında "geri sar", sonra bu
    // transformu yumuşakça sıfıra animasyonla indir — sonuç, gerçek bir kayma/
    // büyüme geçişi gibi görünür.
    const flipFirstRects = new Map();
    allTiles.forEach(tile => flipFirstRects.set(tile, tile.getBoundingClientRect()));

    // Sort tiles based on Smart Gallery Priority Score (Highest score first)
    allTiles.sort((tileA, tileB) => {
      const idA = tileA.id.replace('remoteTile_', '').replace('localParticipantTile', this.currentUser?.id || 'local');
      const idB = tileB.id.replace('remoteTile_', '').replace('localParticipantTile', this.currentUser?.id || 'local');
      return this.getParticipantPriorityScore(idB) - this.getParticipantPriorityScore(idA);
    });

    allTiles.forEach(tile => grid.appendChild(tile));

    // Sayfalama: 24+ katılımcı senaryosunda aynı anda çok fazla video
    // decode edilip donmaya/performans düşüşüne yol açmaması için, o an
    // görünmeyen sayfalardaki videolar duraklatılır (bağlantı canlı kalır,
    // sadece render/decode durur) — sayfa değişince anında devam eder.
    let visibleTiles = allTiles;
    if (totalCount > this.gridTilesPerPage) {
      const totalPages = Math.ceil(totalCount / this.gridTilesPerPage);
      if (this.gridCurrentPage > totalPages) this.gridCurrentPage = totalPages;
      if (this.gridCurrentPage < 1) this.gridCurrentPage = 1;

      const startIndex = (this.gridCurrentPage - 1) * this.gridTilesPerPage;
      const endIndex = startIndex + this.gridTilesPerPage;

      allTiles.forEach((tile, index) => {
        const vid = tile.querySelector('video');
        const isVisible = index >= startIndex && index < endIndex;
        tile.style.setProperty('display', isVisible ? 'flex' : 'none', 'important');
        if (vid) {
          if (isVisible && vid.paused) vid.play().catch(() => { });
          else if (!isVisible && !vid.paused) vid.pause();
        }
      });
      visibleTiles = allTiles.slice(startIndex, endIndex);

      if (paginationControls) {
        paginationControls.style.display = 'flex';
        if (pageIndicator) pageIndicator.textContent = `Sayfa ${this.gridCurrentPage} / ${totalPages}`;
      }
    } else {
      this.gridCurrentPage = 1;
      if (paginationControls) paginationControls.style.display = 'none';

      allTiles.forEach(tile => {
        tile.style.setProperty('display', 'flex', 'important');
        const vid = tile.querySelector('video');
        if (vid && vid.paused) vid.play().catch(() => { });
      });
    }

    // Container'ın GERÇEK anlık boyutunu ölç (sohbet/kenar paneli açık ya da
    // kapalı, pencere ne boyutta olursa olsun) ve o an görünen kart sayısı
    // için optimum sütun sayısı + kart boyutunu hesaplayıp inline uygula.
    //
    // BUG FIX: `getBoundingClientRect()` container'ın PADDING'i dahil border-box
    // ölçüsünü verir; ama flex öğeleri sadece İÇ (content-box) alana sığar.
    // Padding'i düşmeden hesaplanan kart boyutu container'a birkaç piksel
    // fazla geliyor, bu da flex-wrap'ın 2. kartı bir alt satıra itmesine
    // (yan yana durması gereken 2 katılımcının alt alta dizilmesine) sebep
    // oluyordu. Gerçek kullanılabilir alan = rect - padding.
    const rect = grid.getBoundingClientRect();
    const gridComputedStyle = window.getComputedStyle(grid);
    const paddingX = parseFloat(gridComputedStyle.paddingLeft || 0) + parseFloat(gridComputedStyle.paddingRight || 0);
    const paddingY = parseFloat(gridComputedStyle.paddingTop || 0) + parseFloat(gridComputedStyle.paddingBottom || 0);
    const availableWidth = Math.max(0, rect.width - paddingX);
    const availableHeight = Math.max(0, rect.height - paddingY);
    const layout = this.computeOptimalGridLayout(availableWidth, availableHeight, visibleTiles.length);

    grid.style.gap = `${this.GRID_GAP_PX}px`;
    visibleTiles.forEach(tile => {
      // BUG FIX: `tile.style.width = ...` (important bayrağı olmadan) yazılan
      // inline stil, style.css'teki genel `.participant-tile { width:100%
      // !important; height:100% !important }` kuralına karşı KAYBEDİYORDU
      // (CSS kaskad kuralı: normal-öncelikli inline stil, !important'lı bir
      // stylesheet kuralına asla kazanamaz). Sonuç: her kart, hesaplanan
      // boyuttan bağımsız olarak her zaman container'ın %100'üne geriliyor —
      // 2+ katılımcıda kartların üst üste binmesine/bozulmasına yol açıyordu.
      // `setProperty(..., 'important')` ile bu artık düzgün kazanıyor.
      tile.style.setProperty('width', `${Math.floor(layout.tileWidth)}px`, 'important');
      tile.style.setProperty('height', `${Math.floor(layout.tileHeight)}px`, 'important');
    });

    // FLIP — 2/3. adım "Invert" + "Play": yeni (Last) konumla eski (First)
    // konum arasındaki farkı hesaplayıp transform ile telafi eder, sonra bu
    // transformu bir sonraki frame'de sıfıra animasyonla indirir.
    visibleTiles.forEach(tile => {
      const first = flipFirstRects.get(tile);
      if (!first || first.width === 0) return; // Yeni eklenen kart — zıplayacak eski konumu yok

      const last = tile.getBoundingClientRect();
      const deltaX = first.left - last.left;
      const deltaY = first.top - last.top;
      const scaleX = last.width ? first.width / last.width : 1;
      const scaleY = last.height ? first.height / last.height : 1;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1 && Math.abs(scaleX - 1) < 0.01 && Math.abs(scaleY - 1) < 0.01) {
        return; // Konum/boyut zaten aynı, animasyona gerek yok
      }

      // NOT: style.css'teki `.video-grid .participant-tile { transition: ... !important }`
      // kuralı, `!important` olmadan yazılan bir inline `transition:none`'ı ezerdi
      // — FLIP'in ilk adımı (ters transformu ANINDA, geçişsiz uygulamak) bu
      // yüzden `setProperty(..., 'important')` ile yapılıyor.
      tile.style.setProperty('transition', 'none', 'important');
      tile.style.transformOrigin = 'top left';
      tile.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;

      // Tarayıcıyı yukarıdaki "ters" transformu gerçekten uygulamaya zorla,
      // sonra bir sonraki frame'de sıfıra animasyonla indir.
      requestAnimationFrame(() => {
        tile.getBoundingClientRect(); // reflow'u zorla
        tile.style.setProperty('transition', 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)', 'important');
        tile.style.transform = '';
        const clearInlineTransition = () => {
          tile.style.removeProperty('transition');
          tile.removeEventListener('transitionend', clearInlineTransition);
        };
        tile.addEventListener('transitionend', clearInlineTransition);
      });
    });
  },

  _gridResizeObserver: null,

  /**
   * Video grid container'ını izler; sohbet/kenar paneli açılıp kapandığında,
   * pencere yeniden boyutlandığında veya ekran paylaşımı bitip galeri
   * görünümüne dönüldüğünde — HANGİ SEBEPLE olursa olsun container'ın
   * boyutu değiştiğinde — ızgarayı otomatik olarak yeniden hesaplar. Her
   * tetikleyici noktayı (sidebar toggle fonksiyonu, resize event'i, ...) tek
   * tek elle dinlemek yerine tek, güvenilir bir mekanizma.
   */
  setupResponsiveGridObserver() {
    const grid = document.getElementById('videoGrid');
    if (!grid || this._gridResizeObserver) return;

    let debounceTimer = null;
    this._gridResizeObserver = new ResizeObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.reflowVideoGrid(), 80);
    });
    this._gridResizeObserver.observe(grid);
  },

  sendChatMessage(text) {
    if (!text || !text.trim()) return;
    const fullName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Kullanıcı';
    const msgPayload = {
      type: 'chat-message',
      content: text.trim(),
      sender_name: fullName,
      sender_avatar: this.currentUser?.avatar_url || null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    this.sendSignal(msgPayload);
    this.renderChatMessage({ ...msgPayload, sender_id: this.currentUser?.id });
  },

  // BUG FIX: Sohbet mesajları sadece bellekte (DOM'da) tutuluyordu — sayfa F5
  // ile yenilendiğinde tamamen kayboluyordu (kullanıcının kendi ekranında;
  // diğer katılımcılarınki etkilenmiyordu ama kafa karıştırıcıydı). Backend'de
  // notlar gibi kalıcı bir sohbet geçmişi tablosu yok; bu yüzden istemci
  // tarafında `sessionStorage`'a (oda koduna özel, sekme kapanınca zaten
  // temizlenir) yazılıyor ve sayfa her açıldığında geri oynatılıyor. Kullanıcı
  // "Ayrıl"a bastığında (bkz. leaveMeeting/endMeeting) BİLİNÇLİ olarak
  // temizleniyor — istenen davranış tam olarak bu: yenilemede kalıcı,
  // ayrılmada sıfır.
  _chatHistoryKey() {
    return `meeting_chat_history_${this.meetingCode}`;
  },

  _saveChatMessageToHistory(data) {
    try {
      const key = this._chatHistoryKey();
      const list = JSON.parse(sessionStorage.getItem(key) || '[]');
      list.push(data);
      // Sınırsız büyümeyi önlemek için son 200 mesajla sınırla
      const trimmed = list.slice(-200);
      sessionStorage.setItem(key, JSON.stringify(trimmed));
    } catch (e) { /* sessionStorage dolu/erişilemez olsa bile sohbeti bozma */ }
  },

  clearChatHistory() {
    try { sessionStorage.removeItem(this._chatHistoryKey()); } catch (e) { }
  },

  restoreChatHistory() {
    let list = [];
    try { list = JSON.parse(sessionStorage.getItem(this._chatHistoryKey()) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list) || list.length === 0) return;
    list.forEach(msg => this.renderChatMessage(msg, { skipPersist: true, skipUnread: true }));
  },

  renderChatMessage(data, opts = {}) {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;

    const isSelf = (data.sender_id === this.currentUser?.id);
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'self' : 'other'}`;

    bubble.innerHTML = `
      <div class="bubble-meta">
        <span><strong>${data.sender_name || 'Katılımcı'}</strong></span>
        <span>${data.timestamp || ''}</span>
      </div>
      <div class="bubble-content">${data.content}</div>
    `;

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    if (!opts.skipPersist) {
      this._saveChatMessageToHistory(data);
    }

    if (!opts.skipUnread && !isSelf && typeof activeTab !== 'undefined' && activeTab !== 'chat') {
      if (typeof unreadChatCount !== 'undefined') {
        unreadChatCount++;
        if (typeof updateUnreadBadge === 'function') updateUnreadBadge();
      }
    }
  },

  broadcastNote(content, noteId = null) {
    if (!content || !content.trim()) return;
    const authorName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Yönetici';
    const notePayload = {
      type: 'new-note',
      content: content.trim(),
      author: authorName,
      created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      // BUG FIX: `note_id`/`sender_id` eskiden hiç iletilmiyordu — bu yüzden
      // kişisel notlardaki gibi bir "sil" (X) butonu genel notlara asla
      // eklenemiyordu (hangi notun silineceğini belirtecek kimlik yoktu).
      note_id: noteId,
      sender_id: this.currentUser?.id || null
    };
    this.sendSignal(notePayload);
    this.renderLiveNote(notePayload);
    Notifications.show('Toplantı notu herkese canlı olarak yayınlandı.', 'success', 'Yayınlandı');
  },

  renderLiveNote(data) {
    // Genel notlar önbelleğe de eklenir (bkz. generalNotesCache) — sidebar'da
    // Kişisel Notlar'a geçilip geri dönüldüğünde room.html buradan yeniden
    // çizer (kart DOM'dan silinmiş olsa bile veri kaybolmaz).
    this.generalNotesCache.unshift(data);

    const containers = [
      document.getElementById('notesFeedContainer'),
      document.getElementById('sidebarNotesFeedContainer')
    ];

    // Sadece notu YAZAN kişi silebilir (backend de aynısını doğruluyor, bkz.
    // routes/meeting_notes.py delete_meeting_note) — id yoksa (ör. eski
    // kayıtlar veya kayıt anında bir hata oluştuysa) silme butonu hiç
    // gösterilmez, kırık bir buton olmasın diye.
    const isOwnNote = data.note_id && data.sender_id && String(data.sender_id) === String(this.currentUser?.id);

    containers.forEach(container => {
      if (!container) return;

      const placeholder = container.querySelector('div[style*="dashed"]');
      if (placeholder) placeholder.style.display = 'none';

      const card = document.createElement('div');
      card.className = 'note-card';
      if (data.note_id) card.dataset.noteId = data.note_id;
      card.style.background = '#ffffff';
      card.style.border = '1px solid #cbd5e1';
      card.style.borderRadius = '10px';
      card.style.padding = '0.85rem';
      card.style.marginBottom = '0.65rem';
      card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';
      card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.3rem;">
          <div style="font-size: 0.75rem; font-weight: 700; color: #4f46e5;">
            <i class="fas fa-bullhorn"></i> ${data.author || 'Toplantı Kararı'} • ${data.created_at || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          ${isOwnNote ? `
            <button onclick="WebRTC.deleteGeneralNote('${data.note_id}', this)" style="background: none; border: none; color: #ef4444; font-size: 0.85rem; cursor: pointer; flex-shrink: 0;" title="Notu Sil">&times;</button>
          ` : ''}
        </div>
        <div class="note-card-body" style="font-size: 0.88rem; color: #0f172a; line-height: 1.5; white-space: pre-wrap;">${data.content}</div>
      `;

      container.prepend(card);
    });
  },

  // Genel (resmi) notu siler — sadece notu yazan kişi için (backend de aynı
  // kısıtlamayı doğruluyor). Silinince diğer katılımcıların ekranından da
  // kaybolması için bir 'note-deleted' sinyali de yayınlanıyor.
  async deleteGeneralNote(noteId, buttonEl) {
    if (!noteId) return;
    if (!confirm('Bu notu silmek istediğinize emin misiniz?')) return;
    try {
      const res = await fetch(`/api/v1/notes/${noteId}`, {
        method: 'DELETE',
        headers: (typeof Auth !== 'undefined' && Auth.getAuthHeaders) ? Auth.getAuthHeaders() : {}
      });
      if (!res.ok && res.status !== 204) {
        Notifications.show('Not silinemedi — yetkiniz olmayabilir.', 'danger', 'Hata');
        return;
      }
    } catch (e) {
      console.error('Genel not silinirken hata:', e);
      Notifications.show('Not silinirken bir hata oluştu.', 'danger', 'Hata');
      return;
    }

    this._removeGeneralNoteFromUI(noteId);
    this.sendSignal({ type: 'note-deleted', note_id: noteId });
  },

  _removeGeneralNoteFromUI(noteId) {
    this.generalNotesCache = this.generalNotesCache.filter(n => String(n.note_id) !== String(noteId));
    document.querySelectorAll(`.note-card[data-note-id="${noteId}"]`).forEach(card => card.remove());
  },

  removePeer(remoteUserId) {
    if (this.peers[remoteUserId]) {
      this.peers[remoteUserId].close();
      delete this.peers[remoteUserId];
    }
    // BUG FIX: Bunlar temizlenmiyordu; uzun süren, çok katılımcılı toplantılarda
    // (sık giriş/çıkış) sessizce büyüyen bir bellek sızıntısına ve olası eski
    // (stale) ICE candidate/stream referanslarının yanlışlıkla yeniden
    // kullanılmasına yol açıyordu.
    delete this.pendingCandidates[remoteUserId];
    delete this.peerStreams[remoteUserId];
    delete this.peerScreenStreams[remoteUserId];
    const tile = document.getElementById(`remoteTile_${remoteUserId}`);
    if (tile) tile.remove();
  },

  toggleMyMic() {
    this.toggleMic();
  },

  toggleMyCamera() {
    this.toggleCamera();
  },

  toggleMyScreenShare() {
    this.toggleScreenShare();
  },

  showLobbyApprovalNotification(userInfo) {
    if (!this.isUserHost()) return;

    const userId = String(userInfo?.id || userInfo?.user_id || '');
    if (!userId) return;

    const name = userInfo?.name || 'Bir katılımcı';
    const bannerId = `lobbyBanner_${userId}`;

    if (document.getElementById(bannerId)) return;

    try {
      const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
      audio.volume = 0.6;
      audio.play().catch(() => { });
    } catch (e) { }

    // Top notification container placed cleanly below navbar (top: 80px)
    let bannerContainer = document.getElementById('lobbyTopBannerContainer');
    if (!bannerContainer) {
      bannerContainer = document.createElement('div');
      bannerContainer.id = 'lobbyTopBannerContainer';
      bannerContainer.style.cssText = 'position: fixed; top: 80px; left: 50%; transform: translateX(-50%); z-index: 999999; display: flex; flex-direction: column; gap: 10px; pointer-events: auto;';
      document.body.appendChild(bannerContainer);
    }

    const banner = document.createElement('div');
    banner.id = bannerId;
    banner.style.cssText = 'background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #5b5fc7; border-radius: 14px; padding: 0.85rem 1.25rem; display: flex; align-items: center; gap: 1.25rem; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12); color: #0f172a; min-width: 400px; justify-content: space-between;';

    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.85rem; overflow: hidden;">
        <div style="width: 40px; height: 40px; border-radius: 50%; background: #e0e7ff; color: #5b5fc7; display: flex; align-items: center; justify-content: center; font-size: 1.05rem; font-weight: 800; flex-shrink: 0;">
          <i class="fas fa-user-clock"></i>
        </div>
        <div style="overflow: hidden;">
          <div style="font-weight: 800; font-size: 0.9rem; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</div>
          <div style="font-size: 0.78rem; color: #64748b;">Toplantıya katılmak için onay bekliyor</div>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
        <button type="button" onclick="WebRTC.rejectLobbyParticipant('${userId}')" style="background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; border-radius: 8px; padding: 0.45rem 1rem; font-size: 0.82rem; font-weight: 700; cursor: pointer; transition: all 0.2s;">
          Reddet
        </button>
        <button type="button" onclick="WebRTC.approveLobbyParticipant('${userId}')" style="background: #10b981; color: #ffffff; border: none; border-radius: 8px; padding: 0.45rem 1.2rem; font-size: 0.82rem; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: all 0.2s;">
          Kabul Et
        </button>
      </div>
    `;

    bannerContainer.appendChild(banner);
  },

  approveLobbyParticipant(userId) {
    this.sendSignal({
      type: 'lobby-approve',
      target_id: userId
    });
    const bannerEl = document.getElementById(`lobbyBanner_${userId}`);
    if (bannerEl) bannerEl.remove();
  },

  rejectLobbyParticipant(userId) {
    this.sendSignal({
      type: 'lobby-reject',
      target_id: userId
    });
    const bannerEl = document.getElementById(`lobbyBanner_${userId}`);
    if (bannerEl) bannerEl.remove();
  },

  updateMicUI() {
    sessionStorage.setItem('meeting_mic_muted', this.isMicMuted ? '1' : '0');
    const mainBtn = document.getElementById('btnRoomMicMain') || document.getElementById('btnRoomMic');
    const mainIcon = document.getElementById('btnRoomMicIcon');
    const navBtnMic = document.getElementById('navBtnMic');
    const navIconMic = document.getElementById('navIconMic');
    const micGroup = mainBtn?.closest('.teams-split-btn-group');

    if (mainIcon) {
      mainIcon.className = `fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}`;
      mainIcon.style.color = this.isMicMuted ? '#71717a' : '#5b5fc7';
    }
    if (navIconMic) {
      navIconMic.className = `fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}`;
    }
    if (navBtnMic) {
      if (this.isMicMuted) {
        navBtnMic.classList.remove('active-on-purple');
        navBtnMic.classList.add('active-off-gray');
      } else {
        navBtnMic.classList.remove('active-off-gray');
        navBtnMic.classList.add('active-on-purple');
      }
    }

    if (micGroup) {
      if (this.isMicMuted) {
        micGroup.classList.remove('active-on-purple');
        micGroup.classList.add('active-off-gray');
      } else {
        micGroup.classList.remove('active-off-gray');
        micGroup.classList.add('active-on-purple');
      }
    }

    if (this.currentUser?.id && this.participantsMap[this.currentUser.id]) {
      this.participantsMap[this.currentUser.id].isMicMuted = this.isMicMuted;
      this.renderParticipantsList();
    }

    this.sendSignal({
      type: 'user-state-update',
      isMicMuted: this.isMicMuted,
      isCameraOff: this.isCameraOff
    });
  },

  async toggleMic() {
    this.isMicMuted = !this.isMicMuted;

    if (!this.isMicMuted) {
      let audioTrack = this.localStream ? this.localStream.getAudioTracks()[0] : null;
      if (!audioTrack || audioTrack.readyState === 'ended') {
        try {
          const micId = sessionStorage.getItem('meeting_mic_id');
          const audioConstraint = micId ? { deviceId: { exact: micId } } : true;
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
          const newTrack = micStream.getAudioTracks()[0];

          if (newTrack) {
            if (!this.localStream) {
              this.localStream = new MediaStream();
            }
            if (audioTrack) {
              this.localStream.removeTrack(audioTrack);
            }
            this.localStream.addTrack(newTrack);

            Object.values(this.peers).forEach(pc => {
              const sender = pc.getSenders().find(s => s.track?.kind === 'audio' || s.kind === 'audio');
              if (sender) {
                sender.replaceTrack(newTrack).catch(e => console.warn("replaceTrack uyarısı:", e));
              } else {
                pc.addTrack(newTrack, this.localStream);
              }
            });
          }
        } catch (err) {
          console.warn("Mikrofon akışı başlatılamadı:", err);
          if (typeof Notifications !== 'undefined') {
            Notifications.show("Mikrofonunuza erişilemedi veya izin verilmedi.", "warning", "Mikrofon Hatası");
          }
          this.isMicMuted = true;
        }
      } else {
        audioTrack.enabled = true;
      }
    } else {
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => t.enabled = false);
      }
    }

    this.updateMicUI();
  },

  updateCameraUI() {
    sessionStorage.setItem('meeting_cam_off', this.isCameraOff ? '1' : '0');
    const mainBtn = document.getElementById('btnRoomCamMain') || document.getElementById('btnRoomCam');
    const mainIcon = document.getElementById('btnRoomCamIcon');
    const navBtnCam = document.getElementById('navBtnCam');
    const navIconCam = document.getElementById('navIconCam');
    const camGroup = mainBtn?.closest('.teams-split-btn-group');
    const videoEl = document.getElementById('localVideo');
    const avatarEl = document.getElementById('localAvatar');

    if (mainIcon) {
      mainIcon.className = `fas ${this.isCameraOff ? 'fa-video-slash' : 'fa-video'}`;
      mainIcon.style.color = this.isCameraOff ? '#71717a' : '#5b5fc7';
    }
    if (navIconCam) {
      navIconCam.className = `fas ${this.isCameraOff ? 'fa-video-slash' : 'fa-video'}`;
    }
    if (navBtnCam) {
      if (this.isCameraOff) {
        navBtnCam.classList.remove('active-on-purple');
        navBtnCam.classList.add('active-off-gray');
      } else {
        navBtnCam.classList.remove('active-off-gray');
        navBtnCam.classList.add('active-on-purple');
      }
    }

    if (camGroup) {
      if (this.isCameraOff) {
        camGroup.classList.remove('active-on-purple');
        camGroup.classList.add('active-off-gray');
      } else {
        camGroup.classList.remove('active-off-gray');
        camGroup.classList.add('active-on-purple');
      }
    }

    if (videoEl) {
      if (this.localStream && videoEl.srcObject !== this.localStream) {
        videoEl.srcObject = this.localStream;
      }
      videoEl.style.display = this.isCameraOff ? 'none' : 'block';
      if (!this.isCameraOff) {
        videoEl.play().catch(e => console.warn("Lokal video oynatılamadı:", e));
      }
    }

    if (avatarEl) avatarEl.style.display = this.isCameraOff ? 'flex' : 'none';

    if (this.currentUser?.id && this.participantsMap[this.currentUser.id]) {
      this.participantsMap[this.currentUser.id].isCameraOff = this.isCameraOff;
      this.renderParticipantsList();
    }

    this.reflowVideoGrid();

    this.sendSignal({
      type: 'user-state-update',
      isMicMuted: this.isMicMuted,
      isCameraOff: this.isCameraOff
    });
  },

  // NOT: leaveMeeting() / endMeetingForAll() burada eskiden ikinci kez tanımlıydı
  // (JS obje literal'inde aynı anahtar iki kez yazılınca sonuncusu geçerli olur) —
  // bu, kafa karıştıran ve backend'in hiç tanımadığı 'end-meeting' sinyal tipini
  // gönderen ÖLÜ KOD idi. Tek ve güncel tanımları dosyanın altında (bkz. aşağıda
  // endMeeting/endMeetingForAll/leaveMeeting), misafir-farkında yönlendirmeyle
  // birlikte kalıyor.

  async toggleCamera() {
    this.isCameraOff = !this.isCameraOff;

    if (!this.isCameraOff) {
      let videoTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;
      if (!videoTrack || videoTrack.readyState === 'ended') {
        try {
          const camId = sessionStorage.getItem('meeting_cam_id');
          const videoConstraint = camId ? { deviceId: { exact: camId } } : true;
          const camStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint });
          const newTrack = camStream.getVideoTracks()[0];

          if (newTrack) {
            if (!this.localStream) {
              this.localStream = new MediaStream();
            }
            if (videoTrack) {
              this.localStream.removeTrack(videoTrack);
            }
            this.localStream.addTrack(newTrack);

            Object.values(this.peers).forEach(pc => {
              const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.kind === 'video');
              if (sender) {
                sender.replaceTrack(newTrack).catch(e => console.warn("replaceTrack uyarısı:", e));
              } else {
                pc.addTrack(newTrack, this.localStream);
              }
            });
          }
        } catch (err) {
          console.warn("Kamera akışı başlatılamadı:", err);
          if (typeof Notifications !== 'undefined') {
            Notifications.show("Kameranıza erişilemedi veya başka bir uygulama tarafından kullanılıyor.", "warning", "Kamera Hatası");
          }
          this.isCameraOff = true;
        }
      } else {
        videoTrack.enabled = true;
      }
    } else {
      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(t => t.enabled = false);
      }
    }

    this.updateCameraUI();
  },

  // ==========================================================================
  // ORTAK "FLOATING" BAĞLAM MENÜSÜ MOTORU (video kartı üç-nokta + katılımcı
  // satırı üç-nokta menüleri buradan besleniyor)
  //
  // BUG FIX: Menüler eskiden ilgili video kartının/satırın İÇİNE (position:
  // absolute, aynı `overflow: hidden` konteynerin çocuğu olarak — bkz.
  // `.participant-tile { overflow: hidden }`) gömülüydü. Kart küçüldüğünde
  // (çok katılımcılı ızgara) menü kısmen/tamamen KIRPILIP erişilemez hale
  // geliyordu. Artık TEK bir motor, `document.body`'ye eklenmiş, `position:
  // fixed`, ekran sınırlarını asla taşmayan bağımsız bir katman açıyor —
  // hiçbir kartın/satırın clipping'inden etkilenmiyor, kart boyutundan
  // bağımsız her koşulda erişilebilir.
  // ==========================================================================
  closeFloatingMenu() {
    const existing = document.getElementById('wrtcFloatingMenu');
    if (existing) existing.remove();
    if (this._floatingMenuOutsideHandler) {
      document.removeEventListener('click', this._floatingMenuOutsideHandler, true);
      document.removeEventListener('keydown', this._floatingMenuEscHandler, true);
      this._floatingMenuOutsideHandler = null;
      this._floatingMenuEscHandler = null;
    }
  },

  openFloatingMenu(anchorEvent, bodyHtml, options = {}) {
    this.closeFloatingMenu();
    if (!anchorEvent) return;
    if (anchorEvent.stopPropagation) anchorEvent.stopPropagation();

    const menu = document.createElement('div');
    menu.id = 'wrtcFloatingMenu';
    menu.className = 'wrtc-floating-menu';
    menu.innerHTML = bodyHtml;
    // BUG FIX: Menü her zaman document.body'ye ekleniyordu — ama bir kart
    // tarayıcının native Fullscreen API'siyle "top layer"a alındığında, bu
    // katmanın DIŞINDAKİ hiçbir şey (z-index ne olursa olsun, document.body
    // dahil) o kartın ÜSTÜNDE görünemez; top-layer, normal CSS z-index
    // yığılımından tamamen ayrı bir mekanizmadır. Bu yüzden fullscreen
    // sırasında üç-nokta menüsü kartın ARKASINDA kalıyordu. Fullscreen
    // aktifken menüyü document.body yerine BİZZAT fullscreen elementinin
    // İÇİNE (onun bir alt öğesi olarak) ekliyoruz — bu durumda menü de
    // top-layer'ın bir parçası olup kartın üstünde görünür.
    const appendTarget = document.fullscreenElement || document.body;
    appendTarget.appendChild(menu);

    // Konum kaynağı: "usePointerPosition" ile TAM tıklanan nokta (katılımcı
    // satırındaki üç-nokta için istenen davranış), aksi halde tetikleyen
    // butonun/elementin sınırları (video kartındaki üç-nokta için).
    const anchorEl = options.anchorEl || anchorEvent.currentTarget || anchorEvent.target;
    const anchorRect = anchorEl?.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;

    let x = options.usePointerPosition && typeof anchorEvent.clientX === 'number'
      ? anchorEvent.clientX
      : (anchorRect ? anchorRect.left : (anchorEvent.clientX || 0));
    let y = options.usePointerPosition && typeof anchorEvent.clientY === 'number'
      ? anchorEvent.clientY + 8
      : (anchorRect ? anchorRect.bottom + 8 : (anchorEvent.clientY || 0));

    const margin = 10;
    const menuRect = menu.getBoundingClientRect();

    // Sağ/alt kenardan taşmayı engelle
    if (x + menuRect.width + margin > window.innerWidth) {
      x = window.innerWidth - menuRect.width - margin;
    }
    if (x < margin) x = margin;

    if (y + menuRect.height + margin > window.innerHeight) {
      // Aşağıda yer yoksa tetikleyicinin ÜSTÜNE aç
      const flippedY = (anchorRect ? anchorRect.top - menuRect.height - 8 : y - menuRect.height - 16);
      y = flippedY > margin ? flippedY : (window.innerHeight - menuRect.height - margin);
    }
    if (y < margin) y = margin;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    requestAnimationFrame(() => menu.classList.add('open'));

    this._floatingMenuOutsideHandler = (e) => {
      if (!menu.contains(e.target)) this.closeFloatingMenu();
    };
    this._floatingMenuEscHandler = (e) => {
      if (e.key === 'Escape') this.closeFloatingMenu();
    };
    // Aynı tık olayının hemen kendisiyle menüyü kapatmaması için sonraki tick'te bağla
    setTimeout(() => {
      document.addEventListener('click', this._floatingMenuOutsideHandler, true);
      document.addEventListener('keydown', this._floatingMenuEscHandler, true);
    }, 0);
  },

  // Video kartı (yerel veya uzak katılımcı) üç-nokta menüsü
  openTileMenu(event, id) {
    const isLocal = (id === 'local');
    const tileId = isLocal ? 'localParticipantTile' : `remoteTile_${id}`;
    let html = '';

    if (isLocal) {
      html += `
        <button class="menu-item" onclick="WebRTC.toggleCamera(); WebRTC.closeFloatingMenu();">
          <i class="fas ${this.isCameraOff ? 'fa-video' : 'fa-video-slash'}" style="color:#5b5fc7;"></i> ${this.isCameraOff ? 'Kamerayı Aç' : 'Kamerayı Kapat'}
        </button>
        <button class="menu-item" onclick="WebRTC.toggleMic(); WebRTC.closeFloatingMenu();">
          <i class="fas ${this.isMicMuted ? 'fa-microphone' : 'fa-microphone-slash'}" style="color:#10b981;"></i> ${this.isMicMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
        </button>
      `;
    } else {
      html += this._buildRemoteControlsMenuHtml(id);
    }

    // NOT: "Odakla / Büyüt" (pin) seçeneği kullanıcı isteğiyle kaldırıldı;
    // togglePin() fonksiyonu başka bir yerden çağrılmıyorsa artık ölü koddur
    // ama olası başka bir tetikleyici (ör. çift tıklama) bozulmasın diye
    // dokunulmadı.
    html += `
      <div class="wrtc-menu-divider"></div>
      <button class="menu-item" onclick="WebRTC.toggleFullscreen('${tileId}'); WebRTC.closeFloatingMenu();">
        <i class="fas fa-expand-arrows-alt" style="color:#8b5cf6;"></i> Tam Ekran
      </button>
    `;

    this.openFloatingMenu(event, html, { anchorEl: event?.currentTarget });
  },

  // Kişiler (sağ bar) satırındaki üç-nokta menüsü — BUG FIX: eskiden video
  // kartının içindeki menüyü açmaya çalışıyordu (yanlış/bağlantısız konum);
  // artık tıklanan NOKTANIN üzerinde, hangi kullanıcıya ait olduğunu net
  // gösteren bir başlıkla açılıyor.
  openParticipantMenu(event, id) {
    const p = this.participantsMap[id] || {};
    const isSelf = (String(id) === String(this.currentUser?.id));
    const name = p.name || 'Katılımcı';

    let html = `<div class="wrtc-menu-header">${name}${isSelf ? ' <span class="wrtc-menu-self-tag">(Siz)</span>' : ''}</div>`;

    // NOT: Kullanıcı isteğiyle, kişinin KENDİ üç-noktasına basmasında ekstra
    // açıklama metni gösterilmiyor — sadece başlıktaki kendi adı yeterli.
    if (!isSelf) {
      html += this._buildRemoteControlsMenuHtml(id);

      if (this.isUserHost()) {
        html += `
          <div class="wrtc-menu-divider"></div>
          <button class="menu-item danger-item" onclick="WebRTC.kickParticipant('${id}'); WebRTC.closeFloatingMenu();">
            <i class="fas fa-user-minus"></i> Toplantıdan Çıkar
          </button>
        `;
      }
    }

    this.openFloatingMenu(event, html, { usePointerPosition: true });
  },

  // Kart/satır üç-nokta menülerinde ORTAK olan "uzak katılımcı" bölümünü üretir:
  // ses seviyesi/yerel sessize alma (sadece SİZDE değişir) + GÜVENLİK KRİTİK
  // yönetici kontrolleri (mikrofon/kamerayı SADECE kapatabilir, asla açamaz —
  // açma yönü kasıtlı olarak hiç var edilmedi; kamera/mikrofon her koşulda
  // yalnızca kullanıcının kendi eylemiyle açılabilir).
  _buildRemoteControlsMenuHtml(id) {
    const p = this.participantsMap[id] || {};
    const currentVol = Math.round((this.remoteVolumes[id] ?? 1.0) * 100);
    const isLocalMuted = !!this.remoteMuted[id];

    let html = `
      <div class="wrtc-menu-label">SES AYARI (SADECE SİZDE DEĞİŞİR)</div>
      <div class="wrtc-menu-volume-row">
        <input type="range" min="0" max="100" value="${currentVol}" oninput="WebRTC.setRemoteVolume('${id}', this.value)">
        <span id="cardVolumeLabel_${id}">${currentVol}%</span>
      </div>
      <button class="menu-item" onclick="WebRTC.toggleRemoteMute('${id}'); WebRTC.closeFloatingMenu();">
        <i class="fas ${isLocalMuted ? 'fa-volume-up' : 'fa-volume-mute'}" style="color:#f43f5e;"></i> ${isLocalMuted ? 'Sesi Aç' : 'Sessize Al'}
      </button>
    `;

    if (this.isUserHost()) {
      html += `<div class="wrtc-menu-divider"></div><div class="wrtc-menu-label">YÖNETİCİ KONTROLÜ</div>`;
      if (!p.isMicMuted) {
        html += `
          <button class="menu-item danger-item" onclick="WebRTC.requestMuteParticipant('${id}'); WebRTC.closeFloatingMenu();">
            <i class="fas fa-microphone-slash"></i> Mikrofonunu Kapat
          </button>`;
      } else {
        html += `<div class="wrtc-menu-note"><i class="fas fa-microphone-slash"></i> Mikrofonu zaten kapalı</div>`;
      }
      if (!p.isCameraOff) {
        html += `
          <button class="menu-item danger-item" onclick="WebRTC.requestCameraOffParticipant('${id}'); WebRTC.closeFloatingMenu();">
            <i class="fas fa-video-slash"></i> Kamerasını Kapat
          </button>`;
      } else {
        html += `<div class="wrtc-menu-note"><i class="fas fa-video-slash"></i> Kamerası zaten kapalı</div>`;
      }
    }

    return html;
  },

  // GÜVENLİK KRİTİK: Yönetici/editör tarafında — komutu sunucuya gönderir.
  // Sunucu (routes/signaling.py) gönderenin GERÇEKTEN ayrıcalıklı olduğunu
  // yeniden doğrular; bu istemci kontrolü tek başına yeterli değildir.
  requestMuteParticipant(targetId) {
    if (!this.isUserHost() || !targetId) return;
    this.sendSignal({ type: 'host-force-mic-mute', target_id: targetId });
    if (typeof Notifications !== 'undefined') {
      Notifications.show("Katılımcının mikrofonu kapatılıyor.", "info", "Yönetici Kontrolü");
    }
  },

  requestCameraOffParticipant(targetId) {
    if (!this.isUserHost() || !targetId) return;
    this.sendSignal({ type: 'host-force-camera-off', target_id: targetId });
    if (typeof Notifications !== 'undefined') {
      Notifications.show("Katılımcının kamerası kapatılıyor.", "info", "Yönetici Kontrolü");
    }
  },

  // GÜVENLİK KRİTİK: Alıcı (hedeflenen kullanıcı) tarafında — SADECE kapatabilir.
  // Bilhassa: burada "açma" yönünde hiçbir kod yolu YOK ve asla eklenmemeli;
  // kamera/mikrofonu açmak her koşulda yalnızca kullanıcının kendi eylemiyle
  // (toggleMic/toggleCamera üzerinden, tarayıcının kendi izin diyaloğuyla)
  // mümkün olmalıdır.
  forceMuteMicRemote() {
    if (this.isMicMuted) return; // zaten kapalı, tekrar işlem yok
    this.isMicMuted = true;
    if (this.localStream) this.localStream.getAudioTracks().forEach(t => t.enabled = false);
    this.updateMicUI();
    if (typeof Notifications !== 'undefined') {
      Notifications.show("Mikrofonunuz toplantı yöneticisi tarafından kapatıldı.", "warning", "Mikrofon Kapatıldı");
    }
  },

  forceCameraOffRemote() {
    if (this.isCameraOff) return; // zaten kapalı, tekrar işlem yok
    this.isCameraOff = true;
    if (this.localStream) this.localStream.getVideoTracks().forEach(t => t.enabled = false);
    this.updateCameraUI();
    if (typeof Notifications !== 'undefined') {
      Notifications.show("Kameranız toplantı yöneticisi tarafından kapatıldı.", "warning", "Kamera Kapatıldı");
    }
  },

  toggleCardAudioPopover(remoteUserId) {
    const pop = document.getElementById(`cardAudioPopover_${remoteUserId}`);
    if (!pop) return;
    const isShown = (pop.style.display === 'flex');
    document.querySelectorAll('.card-audio-popover').forEach(p => p.style.display = 'none');
    pop.style.display = isShown ? 'none' : 'flex';
  },

  isScreenAudioMuted: false,

  toggleScreenAudioMute() {
    const videoEl = document.getElementById('screenShareVideo');
    if (!videoEl) return;
    this.isScreenAudioMuted = !this.isScreenAudioMuted;
    videoEl.muted = this.isScreenAudioMuted;
    const btnIcon = document.getElementById('btnScreenAudioIcon');
    const btnText = document.getElementById('btnScreenAudioText');
    if (btnIcon) {
      btnIcon.className = `fas ${this.isScreenAudioMuted ? 'fa-volume-mute' : 'fa-volume-up'}`;
      btnIcon.style.color = this.isScreenAudioMuted ? '#f43f5e' : '#6366f1';
    }
    if (btnText) {
      btnText.textContent = this.isScreenAudioMuted ? 'Ekran Sesi Kapalı' : 'Ekran Paylaşımı Sesi';
    }
  },

  setRemoteVolume(remoteUserId, value) {
    const vol = parseFloat(value) / 100;
    this.remoteVolumes[remoteUserId] = vol;
    const audioEl = document.getElementById(`remoteAudio_${remoteUserId}`);
    if (audioEl) {
      audioEl.volume = vol;
      audioEl.muted = (vol === 0 || !!this.remoteMuted[remoteUserId]);
    }
    const label = document.getElementById(`cardVolumeLabel_${remoteUserId}`);
    if (label) label.textContent = `${Math.round(vol * 100)}%`;
  },

  setSpeakingTile(tileId, isSpeaking) {
    const tile = document.getElementById(tileId);
    if (!tile) return;
    if (isSpeaking) {
      tile.classList.add('active-speaker');
    } else {
      tile.classList.remove('active-speaker');
    }
  },

  toggleRemoteMute(remoteUserId) {
    this.remoteMuted[remoteUserId] = !this.remoteMuted[remoteUserId];
    const isMuted = this.remoteMuted[remoteUserId];
    const audioEl = document.getElementById(`remoteAudio_${remoteUserId}`);
    if (audioEl) {
      audioEl.muted = isMuted;
    }
    this.renderRemoteTile(remoteUserId);
  },

  isSpeakerGlowEnabled: true,

  toggleSpeakerGlow() {
    this.isSpeakerGlowEnabled = !this.isSpeakerGlowEnabled;
    const body = document.body;
    if (body) {
      if (this.isSpeakerGlowEnabled) {
        body.classList.remove('active-speaker-glow-off');
      } else {
        body.classList.add('active-speaker-glow-off');
      }
    }
    if (typeof Notifications !== 'undefined') {
      Notifications.show(
        `Konuşmacı yeşil ışık vurgusu ${this.isSpeakerGlowEnabled ? 'açıldı' : 'kapatıldı'}.`,
        "info",
        "Vurgu Ayarı"
      );
    }
  },

  // Kişiler barında gösterilecek 4 kademeli rol etiketi: Toplantı Sahibi >
  // Misafir > Yönetici > Katılımcı. "Toplantı Sahibi" artık odanın o anki
  // TEK "editörüne" (bkz. currentEditorId — sunucudan editor-changed/
  // editor-assigned ile güncellenir) bağlı: gerçek toplantı sahibi çıkıp
  // yerine bir yönetici geçtiğinde etiket OTOMATİK ona taşınır; sahip geri
  // dönerse ünvanı geri alır. currentEditorId henüz gelmediyse (ör. oda
  // durumu daha yeni yükleniyor) meetingInfo.created_by'a düşülür.
  getParticipantRoleInfo(p) {
    const pid = String(p.id || '');
    const isOwner = this.currentEditorId
      ? (pid === String(this.currentEditorId))
      : Boolean(this.meetingInfo?.created_by && pid === String(this.meetingInfo.created_by));

    if (isOwner) {
      return { label: 'Toplantı Sahibi', color: '#5b5fc7' };
    }
    const role = String(p.role || '').toLowerCase();
    if (role === 'guest') {
      return { label: 'Misafir', color: '#d97706' };
    }
    if (['admin', 'manager', 'host', 'moderator', 'yönetici', 'yonetici', 'müdür', 'mudur'].includes(role)) {
      return { label: 'Yönetici', color: '#0ea5e9' };
    }
    return { label: 'Katılımcı', color: '#616161' };
  },

  renderParticipantsList(searchQuery = '') {
    const container = document.getElementById('participantsListContainer');
    if (!container) return;

    const list = Object.values(this.participantsMap);
    const countBadges = document.querySelectorAll('.participant-count-badge');
    countBadges.forEach(el => el.textContent = `${list.length}`);

    const filtered = list.filter(p => {
      const pName = (p.name || '').toLowerCase();
      return pName.includes((searchQuery || '').toLowerCase());
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: #616161; padding: 1.5rem; font-size: 0.85rem; font-weight: 600;">Katılımcı bulunamadı</div>`;
      return;
    }

    container.innerHTML = filtered.map(p => {
      const isSelf = (String(p.id) === String(this.currentUser?.id));
      const roleInfo = this.getParticipantRoleInfo(p);
      const isSpeaking = !!p.isSpeaking;
      const initials = (p.name?.[0] || 'K').toUpperCase();
      const isMicMuted = !!p.isMicMuted;
      const isCameraOff = Boolean(p.isCameraOff);

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.4rem; border-bottom: 1px solid #f3f2f8; transition: background 0.15s ease; border-radius: 8px;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="position: relative; width: 34px; height: 34px; border-radius: 50%; background: #5b5fc7; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.85rem; flex-shrink: 0;">
              ${p.avatar_url ? `<img src="${p.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : initials}
              ${isSpeaking ? `<span style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; background: #10b981; border: 2px solid #ffffff;"></span>` : ''}
            </div>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 0.85rem; font-weight: 800; color: #242424;">${p.name || 'Katılımcı'} ${isSelf ? '<small style="color: #616161;">(Siz)</small>' : ''}</span>
              ${isSpeaking ? `<span style="font-size: 0.7rem; font-weight: 700; color: #10b981;">Konuşuyor</span>` : `
                <span style="font-size: 0.7rem; font-weight: 700; color: ${roleInfo.color};">${roleInfo.label}</span>
              `}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.65rem; font-size: 0.85rem;">
            <i class="fas ${isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${isMicMuted ? '#f43f5e' : '#10b981'};"></i>
            <i class="fas ${isCameraOff ? 'fa-video-slash' : 'fa-video'}" style="color: ${isCameraOff ? '#f43f5e' : '#10b981'};"></i>
            <button type="button" onclick="WebRTC.openParticipantMenu(event, '${p.id}')" title="${p.name || 'Katılımcı'} için seçenekler" style="background: none; border: none; padding: 0.35rem; margin: -0.35rem; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #94a3b8; font-size: 0.85rem;">
              <i class="fas fa-ellipsis-v"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  togglePin(tileId) {
    if (this.pinnedTileId === tileId) {
      this.pinnedTileId = null;
    } else {
      this.pinnedTileId = tileId;
    }
    const grid = document.getElementById('videoGrid');
    if (grid) {
      if (this.pinnedTileId) {
        grid.classList.add('has-pinned-tile');
      } else {
        grid.classList.remove('has-pinned-tile');
      }
    }
    this.renderLocalTile();
    this.renderAllParticipantTiles();
  },

  // BUG FIX: Video kartları, ızgara yerleşimi için `!important` bayraklı
  // INLINE genişlik/yükseklik taşıyor (bkz. reflowVideoGrid ->
  // `style.setProperty('width', ..., 'important')`). CSS kaskadında inline
  // `!important` HER ZAMAN herhangi bir stylesheet kuralını (kendisi
  // `!important` olsa bile) yener. Sonuç: tarayıcı Fullscreen API'siyle kart
  // teknik olarak `document.fullscreenElement` oluyor (siyah "top layer"
  // arka planı beliriyor) ama kartın kendi eski ızgara boyutu (ör. 320x180px)
  // hâlâ geçerli olduğundan, ekranı kaplamak yerine karartılmış arka planın
  // ortasında küçük/bozuk görünüyor — kullanıcıya "tam ekran çalışmıyor"
  // gibi geliyor. Artık fullscreen'e girerken/çıkarken bu inline boyut
  // JS'ten açıkça yönetiliyor.
  toggleFullscreen(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (!this._fullscreenChangeBound) {
      this._fullscreenChangeBound = true;
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && this._lastFullscreenTileId) {
          const prevTile = document.getElementById(this._lastFullscreenTileId);
          if (prevTile) {
            prevTile.style.removeProperty('width');
            prevTile.style.removeProperty('height');
          }
          const wasScreenShare = (this._lastFullscreenTileId === 'screenShareArea');
          this._lastFullscreenTileId = null;
          // Esc tuşuyla veya tarayıcı UI'ından çıkılmış olabilir — ızgarayı
          // gerçek hesaplanan boyutuna geri döndür.
          this.reflowActiveLayout();
          // Ekran paylaşımı kartıysa, çerçeveyi normal sahne boyutuna göre
          // yeniden "contain" hesabıyla oturt (fullscreen'de tamamen farklı
          // bir konteyner boyutu vardı).
          if (wasScreenShare) this._fitScreenShareFrame();
        }
      });
    }

    if (!document.fullscreenElement) {
      this._lastFullscreenTileId = elementId;
      const isScreenShare = (elementId === 'screenShareArea');
      const applyFullscreenSize = () => {
        el.style.setProperty('width', '100%', 'important');
        el.style.setProperty('height', '100%', 'important');
        // Ekran paylaşımı fullscreen'e girdiğinde konteyner artık tüm
        // viewport — çerçeveyi bu YENİ boyuta göre yeniden "contain" hesabıyla
        // oturt, aksi halde eski (küçük sahne) boyutunda kalıp fullscreen'de
        // de gereksiz siyah alan bırakır.
        if (isScreenShare) {
          requestAnimationFrame(() => this._fitScreenShareFrame());
        }
      };
      let request = null;
      if (el.requestFullscreen) {
        request = el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
      if (request && typeof request.then === 'function') {
        request.then(applyFullscreenSize).catch(() => {
          this._lastFullscreenTileId = null;
        });
      } else {
        applyFullscreenSize();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  },

  async switchVideoDevice(deviceId) {
    if (!deviceId) return;
    sessionStorage.setItem('meeting_cam_id', deviceId);

    // Güvenlik Katmanı: Kamera kapalıysa kesinlikle canlı medya başlatma veya akranlara akış gönderme
    if (this.isCameraOff) {
      console.log("[WebRTC Security] Kamera kapalı olduğu için cihaz tercihi saklandı, canlı video akışı başlatılmadı.");
      if (typeof Notifications !== 'undefined') {
        Notifications.show("Kamera cihaz tercihi kaydedildi (Kameranız kapalı).", "info", "Cihaz Tercihi");
      }
      return;
    }

    if (typeof Notifications !== 'undefined') {
      Notifications.show("Kamera cihazı başarıyla değiştirildi.", "success", "Kamera Değişimi");
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } }
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(t => {
          this.localStream.removeTrack(t);
          t.stop();
        });
        this.localStream.addTrack(newTrack);
      } else {
        this.localStream = newStream;
      }

      newTrack.enabled = true;

      Object.values(this.peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.kind === 'video');
        if (sender) {
          sender.replaceTrack(newTrack);
        }
      });

      const videoEl = document.getElementById('localVideo');
      if (videoEl) {
        videoEl.srcObject = this.localStream;
        videoEl.play().catch(console.warn);
      }
    } catch (e) {
      console.warn("Kamera değiştirilemedi:", e);
    }
  },

  async switchAudioInput(deviceId) {
    if (!deviceId) return;
    sessionStorage.setItem('meeting_mic_id', deviceId);

    if (typeof Notifications !== 'undefined') {
      Notifications.show("Mikrofon cihaz tercihi kaydedildi.", "success", "Mikrofon Tercihi");
    }

    // Mikrofon kapalıysa canlı akış değiştirme, tercihi sakla
    if (this.isMicMuted) {
      return;
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) return;

      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(t => {
          this.localStream.removeTrack(t);
          t.stop();
        });
        this.localStream.addTrack(newTrack);
      } else {
        this.localStream = newStream;
      }

      newTrack.enabled = true;

      Object.values(this.peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio' || s.kind === 'audio');
        if (sender) {
          sender.replaceTrack(newTrack);
        }
      });
    } catch (e) {
      console.warn("Mikrofon değiştirilemedi:", e);
    }
  },

  async switchAudioOutput(deviceId) {
    if (!deviceId) return;
    try {
      const mediaElements = document.querySelectorAll('video, audio');
      for (const el of mediaElements) {
        if (typeof el.setSinkId === 'function') {
          await el.setSinkId(deviceId);
        }
      }
      // BUG FIX: Seçilen hoparlör eskiden hiçbir yerde hatırlanmıyordu — bir
      // katılımcının kartı yeniden çizildiğinde (ör. mikrofon/kamera durumu
      // değiştiğinde tile.innerHTML sıfırdan üretiliyor, bkz. renderRemoteTile)
      // ya da toplantıya YENİ biri katıldığında, o kişinin sesi sessizce
      // varsayılan çıkışa geri dönüyordu. Artık tercih burada saklanıp
      // renderRemoteTile'da her yeni <audio> elemanına yeniden uygulanıyor.
      this.selectedSpeakerId = deviceId;
      sessionStorage.setItem('meeting_speaker_id', deviceId);
      if (typeof Notifications !== 'undefined') {
        Notifications.show("Hoparlör çıkışı değiştirildi.", "success", "Hoparlör");
      }
    } catch (e) {
      console.warn("Hoparlör değiştirilemedi:", e);
    }
  },

  // BUG FIX (Kablolu/USB kulaklık toplantı ORTASINDA takıldığında): Tarayıcı
  // yeni bir ses cihazı takıldığında kendiliğinden geçiş YAPMAZ — mevcut
  // mikrofon akışı, kullanıcı elle "Cihaz Ayarları" menüsünden yeni cihazı
  // seçene kadar eski cihazda kalır (bu menüdeki switchAudioInput/Output zaten
  // doğru çalışıyordu, sadece kullanıcıyı bundan HABERDAR eden bir mekanizma
  // yoktu). Burada `devicechange` olayı dinlenip yeni beliren mikrofon/hoparlör
  // için tek tıkla geçiş sunan bir bildirim gösteriliyor; ayrıca o an kullanılan
  // mikrofon çıkarılırsa (fişi çekilirse) sessiz kalmamak için varsayılana
  // otomatik düşülüyor.
  _setupDeviceChangeWatcher() {
    if (this._deviceChangeWatcherBound) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
    this._deviceChangeWatcherBound = true;

    const savedSpeakerId = sessionStorage.getItem('meeting_speaker_id');
    if (savedSpeakerId) this.selectedSpeakerId = savedSpeakerId;

    this._knownAudioInputIds = new Set();
    this._knownAudioOutputIds = new Set();

    const snapshotKnownDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this._knownAudioInputIds = new Set(devices.filter(d => d.kind === 'audioinput').map(d => d.deviceId));
        this._knownAudioOutputIds = new Set(devices.filter(d => d.kind === 'audiooutput').map(d => d.deviceId));
      } catch (e) { /* enumerateDevices başarısız olursa sessizce yut, bir sonraki eventte tekrar denenir */ }
    };

    // Katılınırken mevcut cihaz listesini "bilinen" olarak işaretle — sadece
    // BUNDAN SONRA beliren cihazlar için bildirim gösterilecek.
    snapshotKnownDevices();

    navigator.mediaDevices.addEventListener('devicechange', async () => {
      let devices;
      try {
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (e) {
        return;
      }

      const currentInputs = devices.filter(d => d.kind === 'audioinput');
      const currentOutputs = devices.filter(d => d.kind === 'audiooutput');
      const currentInputIds = new Set(currentInputs.map(d => d.deviceId));

      const newInput = currentInputs.find(d => d.deviceId && !this._knownAudioInputIds.has(d.deviceId));
      const newOutput = currentOutputs.find(d => d.deviceId && !this._knownAudioOutputIds.has(d.deviceId));

      // Yeni takılan mikrofon: tek tıkla geçiş öner.
      if (newInput && typeof Notifications !== 'undefined') {
        const label = newInput.label || 'Yeni mikrofon';
        Notifications.showAction(
          `<strong style="color:#0f172a;">${label}</strong> takıldı. Toplantıda bu mikrofonu kullanmak ister misiniz?`,
          'Bu Mikrofonu Kullan',
          () => this.switchAudioInput(newInput.deviceId),
          'success',
          'Yeni Ses Cihazı Algılandı'
        );
      }

      // Yeni beliren hoparlör/kulaklık çıkışı: tek tıkla geçiş öner.
      if (newOutput && typeof Notifications !== 'undefined') {
        const label = newOutput.label || 'Yeni hoparlör';
        Notifications.showAction(
          `<strong style="color:#0f172a;">${label}</strong> takıldı. Toplantı sesini bu cihazdan dinlemek ister misiniz?`,
          'Bu Hoparlörü Kullan',
          () => this.switchAudioOutput(newOutput.deviceId),
          'success',
          'Yeni Ses Cihazı Algılandı'
        );
      }

      // Şu an aktif kullanılan mikrofon fişten çekildiyse (listeden kalktıysa)
      // sessiz kalmamak için varsayılan mikrofona otomatik düş.
      const activeAudioTrack = this.localStream?.getAudioTracks?.()[0];
      const activeDeviceId = activeAudioTrack?.getSettings?.().deviceId;
      if (activeDeviceId && !currentInputIds.has(activeDeviceId) && !this.isMicMuted) {
        console.warn('[WebRTC] Aktif mikrofon cihazı kayboldu, varsayılana geçiliyor.');
        sessionStorage.removeItem('meeting_mic_id');
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const fallbackTrack = fallbackStream.getAudioTracks()[0];
          if (fallbackTrack) {
            this.localStream.getAudioTracks().forEach(t => { this.localStream.removeTrack(t); t.stop(); });
            this.localStream.addTrack(fallbackTrack);
            fallbackTrack.enabled = true;
            Object.values(this.peers).forEach(pc => {
              const sender = pc.getSenders().find(s => s.track?.kind === 'audio' || s.kind === 'audio');
              if (sender) sender.replaceTrack(fallbackTrack);
            });
            if (typeof Notifications !== 'undefined') {
              Notifications.show('Mikrofonunuzun bağlantısı kesildi, varsayılan mikrofona geçildi.', 'warning', 'Mikrofon Değişti');
            }
          }
        } catch (e) {
          console.warn('Varsayılan mikrofona düşülemedi:', e);
        }
      }

      this._knownAudioInputIds = new Set(currentInputs.map(d => d.deviceId));
      this._knownAudioOutputIds = new Set(currentOutputs.map(d => d.deviceId));

      if (typeof populateDevicePopovers === 'function') {
        try { populateDevicePopovers(); } catch (e) { /* popover kapalıysa DOM elemanları yoktur, yut */ }
      }
    });
  },

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      await this.stopScreenShare();
      return;
    }

    const fullName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Katılımcı';

    // 1. Eğer halihazırda başkası ekran paylaşıyorsa bilgi ver
    if (this.screenSharePresenterId && String(this.screenSharePresenterId) !== String(this.currentUser?.id)) {
      Notifications.show("Toplantıda aktif bir ekran paylaşımı bulunuyor. Aynı anda yalnızca tek bir paylaşım yapılabilir.", "warning", "Ekran Paylaşımı");
      return;
    }

    // 2. Eğer kullanıcı Yönetici/Host/Müdür (Hiyerarşik Üst) ise VEYA izin onaylandıysa doğrudan paylaşımı başlatır
    if (this.canShareScreenDirectly()) {
      await this.startScreenShareFlow();
      return;
    }

    // 3. Eğer sıradan katılımcı ise, Yöneticiden onay ister
    this.sendSignal({
      type: 'screen-share-request',
      requester_name: fullName
    });
    Notifications.show("Toplantı yöneticisine ekran paylaşımı izin talebi gönderildi. Onay bekleniyor...", "info", "İzin İsteği Gönderildi");
  },

  updateScreenShareButtonState(isSharing) {
    const shareBtn = document.getElementById('btnScreenShare');
    const shareText = document.getElementById('btnScreenShareText');
    const shareIcon = document.getElementById('btnScreenShareIcon');
    const navBtnShare = document.getElementById('navBtnShare');
    const navIconShare = document.getElementById('navIconShare');

    if (shareBtn) {
      if (isSharing) {
        shareBtn.style.background = '#fff1f2';
        shareBtn.style.borderColor = '#fecdd3';
        shareBtn.style.color = '#e11d48';
      } else {
        shareBtn.style.background = '';
        shareBtn.style.borderColor = '';
        shareBtn.style.color = '';
      }
    }
    if (shareText) shareText.textContent = isSharing ? 'Paylaşımı Durdur' : 'Paylaş';
    if (shareIcon) shareIcon.className = isSharing ? 'fas fa-circle-stop' : 'fas fa-desktop';

    if (navBtnShare) {
      if (isSharing) {
        navBtnShare.classList.remove('active-off-gray');
        navBtnShare.classList.add('active-on-purple');
      } else {
        navBtnShare.classList.remove('active-on-purple');
        navBtnShare.classList.add('active-off-gray');
      }
    }
    if (navIconShare) {
      navIconShare.className = isSharing ? 'fas fa-stop-circle' : 'fas fa-desktop';
    }
  },

  async startScreenShareFlow() {
    let screenStream = null;
    try {
      // 1. Ekran medya alımı denemesi (Akıcı 60 FPS Video Optimizasyonlu)
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60, max: 60 },
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            cursor: 'always'
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            suppressLocalAudioPlayback: false
          }
        });
      } catch (audioErr) {
        if (audioErr.name !== 'NotAllowedError' && audioErr.name !== 'AbortError') {
          console.warn("[WebRTC] Sesli ekran paylaşımı alınamadı, sadece video ile deneniyor:", audioErr);
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 60, max: 60 } }
          });
        } else {
          throw audioErr;
        }
      }

      if (!screenStream) return;

      this.screenTrack = screenStream.getVideoTracks()[0];
      this.screenAudioTrack = screenStream.getAudioTracks()[0] || null;
      this.screenStream = screenStream;
      if (!this.screenTrack) {
        throw new Error("Ekran video kanalı bulunamadı.");
      }

      // 60 FPS akıcılığı için hareket ipucu ekle (Tarayıcı medya motoruna kilitler)
      if ('contentHint' in this.screenTrack) {
        this.screenTrack.contentHint = 'motion';
      }

      const fullName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Siz';
      this.screenSharePresenterId = this.currentUser?.id;

      // Önce yerel ekran düzenini aktif et
      this.enableScreenShareLayout(fullName, screenStream);

      // Tüm akran bağlantılarına (peers) kamera akışını bozmadan bağımsız ekran track'i ve sistem sesini ekle
      for (const [remoteUserId, pc] of Object.entries(this.peers)) {
        const senders = pc.getSenders();
        let screenSender = senders.find(s => s.track === this.screenTrack);
        if (!screenSender) {
          screenSender = pc.addTrack(this.screenTrack, screenStream);
        }

        if (this.screenAudioTrack) {
          let screenAudioSender = senders.find(s => s.track === this.screenAudioTrack);
          if (!screenAudioSender) {
            pc.addTrack(this.screenAudioTrack, screenStream);
          }
        }

        if (screenSender) {
          try {
            const params = screenSender.getParameters() || {};
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 4500000; // 4.5 Mbps ideal hedef (bitrate dalgalanması ve paket drop'u önler)
            params.encodings[0].minBitrate = 1500000; // 1.5 Mbps taban (ağ yükü altında FPS droplarını engeller)
            params.encodings[0].maxFramerate = 60;
            params.encodings[0].networkPriority = 'high';
            params.encodings[0].priority = 'high';
            params.degradationPreference = 'maintain-framerate'; // Çözünürlük yerine yüksek 60 FPS akıcılığını koru
            await screenSender.setParameters(params);
          } catch (paramErr) {
            console.warn("[WebRTC] Screen sender parametre ayarlama uyarısı:", paramErr);
          }
        }

        // Bağlantı kararlıysa (stable) SDP yeniden müzakere et
        if (pc.signalingState === 'stable') {
          await this.renegotiatePeer(remoteUserId);
        }
      }

      this.sendSignal({
        type: 'screen-share-start',
        presenter_name: fullName,
        stream_id: screenStream.id
      });

      this.isScreenSharing = true;
      sessionStorage.setItem('meeting_screen_sharing', '1');
      this.updateScreenShareButtonState(true);

      // Tarayıcının üst menüsündeki "Paylaşımı Durdur" butonuna tıklandığında tetiklenir
      this.screenTrack.onended = () => this.stopScreenShare();

      Notifications.show("Ekran paylaşımı başlatıldı.", "success", "Ekran Paylaşımı");
    } catch (e) {
      sessionStorage.removeItem('meeting_screen_sharing');
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
        Notifications.show("Ekran paylaşımı iptal edildi.", "info", "Ekran Paylaşımı");
      } else {
        console.error("Ekran paylaşımı hatası:", e);
        Notifications.show(`Ekran paylaşımı başlatılamadı: ${e.message || 'Erişim reddedildi'}`, "error", "Ekran Paylaşımı Hatası");
      }
    }
  },

  showScreenShareApprovalDialog(requesterId, requesterName) {
    let dialog = document.getElementById('screenShareApprovalToast');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'screenShareApprovalToast';
      dialog.className = 'host-approval-toast';
      document.body.appendChild(dialog);
    }
    dialog.style.display = 'flex';
    dialog.innerHTML = `
      <div class="approval-icon">
        <i class="fas fa-desktop"></i>
      </div>
      <div class="approval-body">
        <strong>Ekran Paylaşımı İzin Talebi</strong>
        <span>${requesterName} ekranını tüm katılımcılarla paylaşmak istiyor.</span>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="WebRTC.respondToScreenShareRequest('${requesterId}', true)">
          <i class="fas fa-check"></i> Onayla
        </button>
        <button class="btn-reject" onclick="WebRTC.respondToScreenShareRequest('${requesterId}', false)">
          <i class="fas fa-times"></i> Reddet
        </button>
      </div>
    `;
  },


  respondToScreenShareRequest(requesterId, approved) {
    const dialog = document.getElementById('screenShareApprovalToast');
    if (dialog) {
      dialog.style.opacity = '0';
      dialog.style.transform = 'translate(-50%, -20px)';
      dialog.style.transition = 'all 0.25s ease';
      setTimeout(() => {
        if (dialog.parentNode) dialog.remove();
      }, 250);
    }

    this.sendSignal({
      type: 'screen-share-request-response',
      target_id: requesterId,
      approved: approved
    });
  },

  showScreenShareGrantedDialog() {
    let dialog = document.getElementById('screenShareGrantedToast');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'screenShareGrantedToast';
      dialog.className = 'host-approval-toast';
      document.body.appendChild(dialog);
    }

    dialog.style.display = 'flex';
    dialog.innerHTML = `
      <div class="approval-icon" style="background: rgba(91, 95, 199, 0.15); color: #5b5fc7; border-color: #c7d2fe;">
        <i class="fas fa-desktop"></i>
      </div>
      <div class="approval-body">
        <strong>Ekran Paylaşım İzniniz Onaylandı</strong>
        <span>Yönetici ekran paylaşım talebinizi kabul etti. Ekranınızı seçip yayını başlatabilirsiniz.</span>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="WebRTC.acceptScreenShareApproval()">
          <i class="fas fa-desktop"></i> Ekranı Paylaş
        </button>
      </div>
    `;

    try {
      const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
      audio.play().catch(() => { });
    } catch (e) { }
  },

  acceptScreenShareApproval() {
    const dialog = document.getElementById('screenShareGrantedToast');
    if (dialog) {
      dialog.style.opacity = '0';
      dialog.style.transform = 'translate(-50%, -20px)';
      dialog.style.transition = 'all 0.25s ease';
      setTimeout(() => {
        if (dialog.parentNode) dialog.remove();
      }, 250);
    }
    this.startScreenShareFlow();
  },

  // F5/sayfa yenilemesi öncesi ekran paylaşımı yapıyordum ve odaya geri
  // döndüğümde sunucu paylaşımımı hâlâ "aktif" sayıyor (bkz. room-state
  // handler) — ama gerçek video akışı tarayıcı güvenliği yüzünden kayboldu.
  // Diğer katılımcılara paylaşımın kesildiğini GÖRMEDEN, tek tıkla sürdürmemi
  // (ya da bilerek sonlandırmamı) sağlayan istem.
  promptResumeScreenShare() {
    if (this._resumeSharePromptShown) return;
    this._resumeSharePromptShown = true;

    let dialog = document.getElementById('resumeScreenShareToast');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'resumeScreenShareToast';
      dialog.className = 'host-approval-toast';
      document.body.appendChild(dialog);
    }
    dialog.style.display = 'flex';
    dialog.innerHTML = `
      <div class="approval-icon">
        <i class="fas fa-desktop"></i>
      </div>
      <div class="approval-body">
        <strong>Ekran Paylaşımınız Sürüyor Görünüyor</strong>
        <span>Sayfa yenilendiği için akış kesildi. Diğer katılımcılar hâlâ paylaşımınızı bekliyor — sürdürmek için ekranınızı tekrar seçin.</span>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="WebRTC.resumeScreenShareAfterReload()">
          <i class="fas fa-desktop"></i> Paylaşımı Sürdür
        </button>
        <button class="btn-reject" onclick="WebRTC.dismissResumeScreenSharePrompt()">
          <i class="fas fa-times"></i> Paylaşımı Sonlandır
        </button>
      </div>
    `;
  },

  resumeScreenShareAfterReload() {
    const dialog = document.getElementById('resumeScreenShareToast');
    if (dialog) dialog.remove();
    this._resumeSharePromptShown = false;
    this.startScreenShareFlow();
  },

  dismissResumeScreenSharePrompt() {
    const dialog = document.getElementById('resumeScreenShareToast');
    if (dialog) dialog.remove();
    this._resumeSharePromptShown = false;

    if (this.screenSharePresenterId === String(this.currentUser?.id)) {
      this.sendSignal({ type: 'screen-share-stop' });
      this.screenSharePresenterId = null;
      this.activeScreenStreamId = null;
      this.disableScreenShareLayout();
    }
    sessionStorage.removeItem('meeting_screen_sharing');
  },

  showGuestApprovalDialog(guestId, guestName) {
    let dialog = document.getElementById('guestApprovalToast');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'guestApprovalToast';
      dialog.className = 'host-approval-toast';
      document.body.appendChild(dialog);
    }
    dialog.style.display = 'flex';
    dialog.innerHTML = `
      <div class="approval-icon" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">
        <i class="fas fa-user-plus"></i>
      </div>
      <div class="approval-body">
        <strong>Lobi Katılım Talebi</strong>
        <span><b>${guestName}</b> toplantı odasına katılmak için onayınızı bekliyor.</span>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" id="btnApprove_${guestId}" onclick="WebRTC.respondToGuestRequest('${guestId}', true, this)">
          <i class="fas fa-check"></i> Kabul Et
        </button>
        <button class="btn-reject" id="btnReject_${guestId}" onclick="WebRTC.respondToGuestRequest('${guestId}', false, this)">
          <i class="fas fa-times"></i> Reddet
        </button>
      </div>
    `;

    // Uyarı zili ve bildirim fırlat
    try {
      const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
      audio.play().catch(() => { });
    } catch (e) { }

    if (window.Notifications) {
      Notifications.show(`Katılım Talebi: ${guestName} lobi bekleme odasında onay bekliyor.`, 'info', 'Lobi Bildirimi');
    }
  },

  respondToGuestRequest(guestId, approved, btnEl) {
    if (btnEl) btnEl.disabled = true;
    const dialog = document.getElementById('guestApprovalToast');
    if (dialog) dialog.style.display = 'none';

    this.sendSignal({
      type: 'guest-join-response',
      target_id: guestId,
      guest_id: guestId,
      approved: approved
    });
  },

  // BUG FIX: Alt bildirim çubuğundaki "Paylaşımı Durdur" overlay butonu
  // (btnStopMyShareOverlay, bkz. room.html) `WebRTC.stopMyScreenShare()`
  // çağırıyordu ama bu fonksiyon hiç tanımlı değildi — tıklandığında sessizce
  // "is not a function" hatası veriyor, paylaşım hiç durmuyordu. Gerçek
  // durdurma mantığı zaten stopScreenShare()'de var; bu sadece ona köprü
  // kuruyor ve düğmenin yalnızca gerçek sunucu (aktif ekran paylaşımını
  // yapan kişi) için işlem yapmasını garanti ediyor.
  async stopMyScreenShare() {
    if (String(this.screenSharePresenterId) !== String(this.currentUser?.id)) return;
    await this.stopScreenShare();
  },

  async stopScreenShare() {
    const oldScreenTrack = this.screenTrack;
    const oldScreenAudioTrack = this.screenAudioTrack;

    if (oldScreenTrack) {
      oldScreenTrack.stop();
      this.screenTrack = null;
    }
    if (oldScreenAudioTrack) {
      oldScreenAudioTrack.stop();
      this.screenAudioTrack = null;
    }
    this.screenStream = null;

    for (const [remoteUserId, pc] of Object.entries(this.peers)) {
      const senders = pc.getSenders();
      const screenSender = senders.find(s => s.track === oldScreenTrack || (s.track && s.track.label.toLowerCase().includes('screen')));
      if (screenSender) {
        try {
          pc.removeTrack(screenSender);
        } catch (e) {
          console.warn("Screen sender kaldırma uyarısı:", e);
        }
      }
      if (oldScreenAudioTrack) {
        const audioSender = senders.find(s => s.track === oldScreenAudioTrack);
        if (audioSender) {
          try { pc.removeTrack(audioSender); } catch (e) { }
        }
      }
      if (pc.signalingState === 'stable') {
        await this.renegotiatePeer(remoteUserId);
      }
    }

    this.screenSharePresenterId = null;
    this.disableScreenShareLayout();

    // Yerel kamera akışını kendi video bileşenine otomatik geri bağla
    const localVid = document.getElementById('localVideo');
    if (localVid && this.localStream) {
      localVid.srcObject = this.localStream;
      localVid.play().catch(() => { });
    }

    this.renderLocalTile();

    this.sendSignal({ type: 'screen-share-stop' });

    this.isScreenSharing = false;
    sessionStorage.removeItem('meeting_screen_sharing');
    this.updateScreenShareButtonState(false);
    Notifications.show("Ekran paylaşımı sonlandırıldı.", "info", "Ekran Paylaşımı");
  },

  toggleScreenShareFullscreen() {
    const shareVid = document.getElementById('screenShareVideo');
    if (!shareVid) return;
    if (!document.fullscreenElement) {
      if (shareVid.requestFullscreen) shareVid.requestFullscreen();
      else if (shareVid.webkitRequestFullscreen) shareVid.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  },

  popoutScreenShare() {
    const shareVid = document.getElementById('screenShareVideo');
    if (!shareVid || !shareVid.srcObject) {
      Notifications.show('Aktif ekran paylaşımı bulunamadı.', 'warning', 'Ekran Paylaşımı');
      return;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(console.warn);
    } else if (shareVid.requestPictureInPicture) {
      shareVid.requestPictureInPicture().catch(err => {
        console.warn("Picture-in-Picture başlatılamadı:", err);
      });
    }
  },


  kickParticipant(userId) {
    if (confirm("Bu katılımcıyı toplantıdan çıkarmak istediğinize emin misiniz?")) {
      this.sendSignal({
        type: 'host-kick',
        target_id: userId
      });
      this.removePeer(userId);
    }
  },

  endMeeting() {
    // Güvenlik: misafir/sıradan katılımcı bu fonksiyona UI'dan hiç erişemez
    // (bkz. room.html üç-nokta/ayrıl menüsü gizleme), ama savunma amaçlı burada
    // da doğrulanıyor — yalnızca ayrıcalıklı (host/admin/manager) kullanıcılar
    // toplantıyı herkes için sonlandırabilir.
    if (!this.isUserHost()) {
      this.leaveMeeting();
      return;
    }
    if (confirm("Toplantıyı herkes için sonlandırmak istediğinize emin misiniz?")) {
      this.sendSignal({ type: 'meeting-ended' });
      if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
      this.clearChatHistory();
      const isGuestUser = this.currentUser?.role === 'guest';
      window.location.href = isGuestUser ? `/guest/${this.meetingCode}` : `/reports/${this.meetingInfo?.id || ''}`;
    }
  },

  endMeetingForAll() {
    this.endMeeting();
  },

  leaveMeeting() {
    // BUG FIX: Misafir ayrıldığında herkes gibi '/' (ana sayfa/dashboard)'a
    // atılıyordu — misafirin orada (giriş yapılmış bir hesabı olmadığından)
    // hiçbir işi yok, /login'e sekiyordu ve "toplantı bitti" bilgisi de hiç
    // gösterilmiyordu. Misafirler artık kendi güvenli giriş ekranına
    // (/guest/{code}) döner: toplantı hâlâ açıksa aynı bilgilerle tekrar
    // katılım talebi atabilir, toplantı bittiyse orada net biçimde engellenir
    // (bkz. guest.html) — kayıtlı kullanıcılar değişmeden dashboard'a gider.
    this.sendSignal({ type: 'user-left', explicit: true });
    if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
    if (this.socket) { try { this.socket.close(); } catch (e) { } }
    this.clearChatHistory();
    const isGuestUser = this.currentUser?.role === 'guest';
    // BUG FIX: kicked/guest-rejected/meeting-ended akışlarıyla tutarlı olsun diye
    // — misafirin artık geçersiz guest_token'ı sistemde/sekmede açık kalmasın.
    if (isGuestUser) sessionStorage.removeItem('guest_token');
    window.location.href = isGuestUser ? `/guest/${this.meetingCode}` : '/';
  },

  startTimer() {
    const timerEl = document.getElementById('roomTimer');
    let meetingStart = new Date();

    if (this.meetingInfo) {
      const startStr = this.meetingInfo.actual_start || this.meetingInfo.created_at || this.meetingInfo.scheduled_start;
      if (startStr) {
        meetingStart = new Date(startStr);
      }
    }

    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const now = new Date();
      const diffSec = Math.max(0, Math.floor((now - meetingStart) / 1000));
      const hrs = String(Math.floor(diffSec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
      const secs = String(diffSec % 60).padStart(2, '0');

      if (timerEl) timerEl.textContent = `${hrs}:${mins}:${secs}`;
    }, 1000);
  },

  updateConnectionBadge(status, text) {
    const dot = document.getElementById('connectionDot');
    const textEl = document.getElementById('connectionText');

    if (dot) {
      dot.style.background = status === 'online' ? 'var(--accent-emerald)' : (status === 'reconnecting' ? 'var(--accent-amber)' : 'var(--accent-rose)');
    }
    if (textEl) textEl.textContent = text;
  },

  bindRoomControls() {
    const micBtn = document.getElementById('btnRoomMicMain') || document.getElementById('btnRoomMic');
    if (micBtn) {
      micBtn.onclick = () => this.toggleMic();
    }
    const camBtn = document.getElementById('btnRoomCamMain') || document.getElementById('btnRoomCam');
    if (camBtn) {
      camBtn.onclick = () => this.toggleCamera();
    }
    const shareBtn = document.getElementById('btnScreenShare');
    if (shareBtn) {
      shareBtn.onclick = () => this.toggleScreenShare();
    }
    const leaveBtn = document.getElementById('btnLeaveRoom');
    if (leaveBtn) {
      leaveBtn.onclick = () => this.leaveMeeting();
    }
    const endHostBtn = document.getElementById('btnEndMeetingHost');
    if (endHostBtn) {
      endHostBtn.onclick = () => this.endMeeting();
    }
  },


};

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
    sessionStorage.removeItem('meeting_screen_sharing');
    this.disableScreenShareLayout();

    this.bindAutoplayUnlock();

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

    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);

      // Mevcut tüm akran bağlantılarına yerel medya kanallarını anında kilitler
      Object.values(this.peers).forEach(pc => this.attachLocalTracksToPeer(pc));
    }

    this.renderLocalTile();
    this.updateMicUI();
    this.updateCameraUI();
    this.connectWebSocket();
    this.startTimer();
    this.bindRoomControls();

    // Sayfa yenilendiğinde/kapatıldığında aktif ekran paylaşımını oda üyeleri için temizle
    window.addEventListener('beforeunload', () => {
      if (this.isScreenSharing) {
        this.sendSignal({ type: 'screen-share-stop' });
      }
    });
  },

  async loadExistingNotes() {
    if (!this.meetingInfo?.id) return;
    if (typeof Auth === 'undefined' || !Auth.getToken()) return;
    try {
      const res = await fetch(`/api/v1/notes/meeting/${this.meetingInfo.id}`, {
        headers: Auth.getAuthHeaders()
      });
      if (res.ok) {
        const notes = await res.json();
        notes.forEach(note => {
          this.renderLiveNote({
            content: note.content,
            author: 'Toplantı Notu',
            created_at: new Date(note.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

        response = await fetch(`/api/v1/meetings/code/${this.meetingCode}`, {
          headers: Auth.getAuthHeaders()
        });
        if (response.ok) {
          this.meetingInfo = await response.json();

          if (typeof Auth !== 'undefined' && Auth.getCurrentUser) {
            this.currentUser = Auth.getCurrentUser();
          } else if (typeof Auth !== 'undefined' && Auth.getUser) {
            this.currentUser = Auth.getUser();
          }

          const isCreator = (this.currentUser && this.meetingInfo && (
            String(this.meetingInfo.created_by) === String(this.currentUser.id) ||
            String(this.meetingInfo.created_by) === String(this.currentUser.user_id)
          ));
          const isAdmin = (this.currentUser && (this.currentUser.role === 'admin' || this.currentUser.role === 'host' || this.currentUser.is_superuser));

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

        // Yönetici olmayan kullanıcılar için Oda Düzenleme ve Davet butonlarını gizle (Sadece link kopyalama kalsın)
        const btnOptionInvite = document.getElementById('btnOptionInviteUser');
        if (btnOptionInvite) btnOptionInvite.style.display = this.isUserHost() ? 'flex' : 'none';

        const btnOptionSettings = document.getElementById('btnOptionEditSettings');
        if (btnOptionSettings) btnOptionSettings.style.display = this.isUserHost() ? 'flex' : 'none';

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
      if (u.role === 'admin' || u.role === 'host' || u.role === 'manager' || u.is_superuser) return true;
      if (this.meetingInfo && this.meetingInfo.created_by) {
        const creatorId = String(this.meetingInfo.created_by).toLowerCase();
        const userId = String(u.id || u.user_id || u.sub || '').toLowerCase();
        if (userId && creatorId === userId) return true;
      }
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

  connectWebSocket() {
    const urlParams = new URLSearchParams(window.location.search);
    const guestToken = urlParams.get('guest_token') || sessionStorage.getItem('guest_token');
    const token = Auth.getToken();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = '';

    if (guestToken) {
      wsUrl = `${protocol}//${window.location.host}/api/v1/signaling/ws/${this.meetingCode}?guest_token=${encodeURIComponent(guestToken)}`;
    } else {
      wsUrl = `${protocol}//${window.location.host}/api/v1/signaling/ws/${this.meetingCode}?token=${token}`;
    }

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log("WebSocket Sinyalleşme Sunucusuna Bağlandı.");
      this.updateConnectionBadge('online', 'Bağlı');

      const myName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Kullanıcı';

      this.participantsMap[this.currentUser.id] = {
        id: this.currentUser.id,
        name: myName,
        avatar_url: this.currentUser?.avatar_url,
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
      }
    };
  },

  renderParticipantsList() {
    const container = document.getElementById('participantsListContainer');
    const countBadge = document.getElementById('participantCountBadge');
    if (!container) return;

    const list = Object.values(this.participantsMap);
    if (countBadge) countBadge.textContent = list.length;

    container.innerHTML = list.map(p => {
      const isMe = (p.id === this.currentUser?.id);
      const initials = (p.name?.[0] || 'K').toUpperCase();
      const isHostUser = (p.id === this.meetingInfo?.created_by);

      return `
        <div class="participant-list-item">
          <div class="participant-info">
            <div class="participant-avatar-sm">
              ${p.avatar_url ? `<img src="${p.avatar_url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : initials}
            </div>
            <div>
              <div style="font-size: 0.88rem; font-weight: 600; display: flex; align-items: center; gap: 0.4rem;">
                <span>${p.name}</span>
                ${isMe ? '<span style="font-size: 0.75rem; color: var(--text-secondary);">(Siz)</span>' : ''}
              </div>
              <span class="role-badge ${isHostUser ? 'role-badge-admin' : 'role-badge-user'}">
                ${isHostUser ? 'Yönetici' : 'Katılımcı'}
              </span>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <i class="fas ${p.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${p.isMicMuted ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-size: 0.9rem;"></i>
            ${this.isHost && !isMe ? `
              <button onclick="WebRTC.kickParticipant('${p.id}')" class="btn btn-danger" style="padding: 0.2rem 0.4rem; font-size: 0.7rem;" title="Çıkar">
                <i class="fas fa-user-minus"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  },

  sendSignal(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  },

  async handleSignal(data) {
    const senderId = data.sender_id;

    switch (data.type) {
      case 'room-state':
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
          const presenterStream = this.peerStreams[presenterId] || (document.getElementById(`remoteVideo_${presenterId}`)?.srcObject) || null;
          if (presenterStream) {
            this.enableScreenShareLayout(data.active_screen_share.presenter_name || 'Katılımcı', presenterStream);
          } else {
            // Stream henüz hazır değil — UI'ı gizle ama presenter ID'yi koru
            // ontrack gelince isScreenStreamIdMatch ile layout tekrar açılacak
            this.disableScreenShareLayout(true); // preservePresenterId=true
          }
        } else {
          this.activeScreenStreamId = null;
          this.disableScreenShareLayout();
        }
        break;

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

      case 'video-offer':
        if (senderId) {
          const pc = await this.createPeerConnection(senderId, false);

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

          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
      case 'guest-rejected':
        Notifications.show(data.message || "Toplantı odası erişiminiz sonlandırıldı.", "danger", "Erişim Reddedildi");
        if (this.socket) {
          try { this.socket.close(4003, "Kicked/Rejected"); } catch (e) { }
        }
        setTimeout(() => {
          sessionStorage.removeItem('guest_token');
          window.location.replace('/');
        }, 1200);
        break;

      case 'meeting-ended':
        alert("Toplantı yönetici tarafından sonlandırıldı.");
        window.location.href = `/reports/${this.meetingInfo?.id || ''}`;
        break;
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
    if (this.peers[remoteUserId]) {
      this.attachLocalTracksToPeer(this.peers[remoteUserId]);
      return this.peers[remoteUserId];
    }

    const pc = new RTCPeerConnection(this.getIceServers());
    this.peers[remoteUserId] = pc;

    this.attachLocalTracksToPeer(pc);

    if (this.isScreenSharing && this.screenTrack) {
      pc.addTrack(this.screenTrack);
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

        // Ekran paylaşımı tespiti — yalnızca kesin stream_id eşleşmesi veya label/streamId bazlı
        // NOT: contentHint==='motion' ve (isPresenter && hasExistingWebcam) heuristikleri kaldırıldı;
        // bunlar kamera akışlarını yanlışlıkla ekran paylaşımı olarak tanımlayabiliyordu.
        const isExplicitScreen = streamIdLower.includes('screen') || streamIdLower.includes('display') ||
          trackLabel.includes('screen') || trackLabel.includes('display') ||
          trackLabel.includes('window') || trackLabel.includes('monitor') ||
          trackLabel.includes('desktop') || trackLabel.includes('entire');

        const isScreenStreamIdMatch = Boolean(this.activeScreenStreamId && streamId === this.activeScreenStreamId);

        if (isScreenStreamIdMatch || isExplicitScreen) {
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
      
      <!-- TOP-RIGHT 3-DOTS CONTEXT MENU BUTTON -->
      <button class="tile-more-btn" onclick="WebRTC.toggleCardContextMenu(event, 'local')" title="Kart Seçenekleri" style="position: absolute; top: 0.65rem; right: 0.65rem; background: rgba(0,0,0,0.5); color: #fff; border: none; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; z-index: 15; backdrop-filter: blur(4px);">
        <i class="fas fa-ellipsis-v" style="font-size: 0.8rem;"></i>
      </button>

      <!-- CONTEXT MENU POPOVER -->
      <div id="cardContextMenu_local" class="card-context-menu" style="display: none;">
        <button class="menu-item" onclick="WebRTC.toggleCamera()">
          <i class="fas ${this.isCameraOff ? 'fa-video' : 'fa-video-slash'}" style="color: #5b5fc7;"></i> ${this.isCameraOff ? 'Kamerayı Aç' : 'Kamerayı Kapat'}
        </button>
        <button class="menu-item" onclick="WebRTC.toggleMic()">
          <i class="fas ${this.isMicMuted ? 'fa-microphone' : 'fa-microphone-slash'}" style="color: #10b981;"></i> ${this.isMicMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
        </button>
        <button class="menu-item" onclick="WebRTC.togglePin('localParticipantTile')">
          <i class="fas ${isPinned ? 'fa-compress' : 'fa-expand'}" style="color: #0ea5e9;"></i> ${isPinned ? 'Odaklamayı Kaldır' : 'Odakla / Büyüt'}
        </button>
        <button class="menu-item" onclick="WebRTC.toggleFullscreen('localParticipantTile')">
          <i class="fas fa-expand-arrows-alt" style="color: #8b5cf6;"></i> Tam Ekran
        </button>
      </div>

      <!-- TRANSLUCENT DARK OVERLAY PILL WITH WHITE TEXT AT BOTTOM-LEFT -->
      <div class="tile-overlay-pill">
        <i class="fas fa-thumbtack" style="font-size: 0.72rem; color: #ffffff; opacity: 0.85;"></i>
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
    const isHostUser = (remoteUserId === this.meetingInfo?.created_by);

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

      <!-- TOP-RIGHT 3-DOTS CONTEXT MENU BUTTON -->
      <button class="tile-more-btn" onclick="WebRTC.toggleCardContextMenu(event, '${remoteUserId}')" title="Katılımcı Seçenekleri" style="position: absolute; top: 0.65rem; right: 0.65rem; background: rgba(0,0,0,0.5); color: #fff; border: none; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; z-index: 15; backdrop-filter: blur(4px);">
        <i class="fas fa-ellipsis-v" style="font-size: 0.8rem;"></i>
      </button>

      <!-- CONTEXT MENU POPOVER -->
      <div id="cardContextMenu_${remoteUserId}" class="card-context-menu" style="display: none;">
        <div style="font-size: 0.7rem; font-weight: 800; color: #94a3b8; padding: 0.2rem 0.4rem;">SES AYARI</div>
        <div style="padding: 0.2rem 0.4rem; display: flex; align-items: center; gap: 0.5rem;">
          <input type="range" min="0" max="100" value="${Math.round(currentVol * 100)}" 
                 oninput="WebRTC.setRemoteVolume('${remoteUserId}', this.value)" style="width: 100%; accent-color: #5b5fc7;">
          <span id="cardVolumeLabel_${remoteUserId}" style="font-size: 0.75rem; font-weight: 800; color: #475569; min-width: 32px;">${Math.round(currentVol * 100)}%</span>
        </div>
        <button class="menu-item" onclick="WebRTC.toggleRemoteMute('${remoteUserId}')">
          <i class="fas ${isLocalMuted ? 'fa-volume-up' : 'fa-volume-mute'}" style="color: #f43f5e;"></i> ${isLocalMuted ? 'Sesi Aç' : 'Sessize Al'}
        </button>
        <div style="height: 1px; background: #e2e8f0; margin: 0.2rem 0;"></div>
        <button class="menu-item" onclick="WebRTC.togglePin('remoteTile_${remoteUserId}')">
          <i class="fas ${isPinned ? 'fa-compress' : 'fa-expand'}" style="color: #0ea5e9;"></i> ${isPinned ? 'Odaklamayı Kaldır' : 'Odakla / Büyüt'}
        </button>
        <button class="menu-item" onclick="WebRTC.toggleFullscreen('remoteTile_${remoteUserId}')">
          <i class="fas fa-expand-arrows-alt" style="color: #8b5cf6;"></i> Tam Ekran
        </button>
      </div>

      <!-- TRANSLUCENT DARK OVERLAY PILL WITH WHITE TEXT AT BOTTOM-LEFT -->
      <div class="tile-overlay-pill">
        <i class="fas fa-thumbtack" style="font-size: 0.72rem; color: #ffffff; opacity: 0.85;"></i>
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

    const presenterEl = document.getElementById('screenSharePresenterName');
    if (presenterEl) presenterEl.textContent = `${presenterName} ekranını paylaşıyor`;

    const stopBtn = document.getElementById('btnStopMyShareOverlay');
    if (stopBtn) {
      stopBtn.style.display = (this.screenSharePresenterId === this.currentUser?.id) ? 'inline-block' : 'none';
    }

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
      shareVid.muted = (this.screenSharePresenterId === this.currentUser?.id);
      shareVid.srcObject = stream;
      shareVid.play().catch(e => console.warn(e));
    }
  },

  toggleScreenShareAudio() {
    const shareVid = document.getElementById('screenShareVideo');
    const icon = document.getElementById('iconShareAudio');
    if (shareVid) {
      shareVid.muted = !shareVid.muted;
      if (icon) {
        icon.className = shareVid.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
        icon.style.color = shareVid.muted ? '#f87171' : '#ffffff';
      }
    }
  },

  showShareSettingsModal() {
    if (typeof showToast === 'function') {
      showToast('Ekran Paylaşım Ayarları: Yayın yüksek kalitede (1080p 60fps) iletiliyor.', 'info');
    } else {
      alert('Ekran Paylaşım Ayarları: Yayın yüksek kalitede (1080p 60fps) iletiliyor.');
    }
  },

  disableScreenShareLayout(preservePresenterId = false) {
    const shareArea = document.getElementById('screenShareArea');
    const grid = document.getElementById('videoGrid');
    const topBar = document.getElementById('topCarouselBar');
    const headerShareBadge = document.getElementById('headerScreenShareBadge');

    if (!shareArea || !grid) return;

    shareArea.style.setProperty('display', 'none', 'important');
    grid.style.setProperty('display', 'grid', 'important');
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
    const topBar = document.getElementById('topCarouselBar');
    if (!topBar || topBar.style.display === 'none') return;

    const existingOverflow = topBar.querySelector('.overflow-tile');
    if (existingOverflow) existingOverflow.remove();

    const tiles = Array.from(topBar.querySelectorAll('.participant-tile:not(.overflow-tile)'));
    const count = tiles.length;

    tiles.forEach(tile => tile.style.display = 'flex');

    const maxVisibleInBar = 6;

    if (count > maxVisibleInBar) {
      const overflowCount = count - (maxVisibleInBar - 1);
      tiles.forEach((tile, index) => {
        if (index < (maxVisibleInBar - 1)) {
          tile.style.display = 'flex';
        } else {
          tile.style.display = 'none';
        }
      });

      const overflowTile = document.createElement('div');
      overflowTile.className = 'participant-tile overflow-tile';
      overflowTile.style.cssText = 'height: 100%; aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center; background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; cursor: pointer; flex-shrink: 0;';
      overflowTile.onclick = () => {
        if (typeof toggleSidebarTab === 'function') {
          toggleSidebarTab('participants');
        }
      };
      overflowTile.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.2rem; text-align: center;">
          <div style="font-size: 1.3rem; font-weight: 800; color: #5b5fc7;">+${overflowCount}</div>
          <div style="font-size: 0.75rem; font-weight: 700; color: #475569;">Daha fazla</div>
        </div>
      `;
      topBar.appendChild(overflowTile);
    }
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

  reflowVideoGrid() {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    // Reset inline grid styles
    grid.style.gridTemplateColumns = '';
    grid.style.gridTemplateRows = '';
    grid.style.gridTemplateAreas = '';

    // Reset layout classes
    grid.classList.remove('grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-5', 'grid-6', 'grid-8', 'grid-12', 'grid-multi');

    // Remove existing overflow tile
    const existingOverflow = grid.querySelector('.overflow-tile');
    if (existingOverflow) existingOverflow.remove();

    // Get all participant tiles currently in grid
    const allTiles = Array.from(grid.querySelectorAll('.participant-tile:not(.overflow-tile)'));
    const totalCount = allTiles.length;

    if (totalCount === 0) {
      grid.classList.add('grid-1');
      return;
    }

    // Sort all tiles based on Smart Gallery Priority Score (Highest score first)
    allTiles.sort((tileA, tileB) => {
      const idA = tileA.id.replace('remoteTile_', '').replace('localParticipantTile', this.currentUser?.id || 'local');
      const idB = tileB.id.replace('remoteTile_', '').replace('localParticipantTile', this.currentUser?.id || 'local');
      return this.getParticipantPriorityScore(idB) - this.getParticipantPriorityScore(idA);
    });

    // Re-append sorted tiles back into grid in priority order
    allTiles.forEach(tile => grid.appendChild(tile));

    if (totalCount <= 1) {
      grid.classList.add('grid-1');
      allTiles.forEach(tile => {
        tile.style.setProperty('display', 'flex', 'important');
        const vid = tile.querySelector('video');
        if (vid && vid.paused) vid.play().catch(e => { });
      });
    } else if (totalCount === 2) {
      grid.classList.add('grid-2');
      allTiles.forEach(tile => {
        tile.style.setProperty('display', 'flex', 'important');
        const vid = tile.querySelector('video');
        if (vid && vid.paused) vid.play().catch(e => { });
      });
    } else if (totalCount === 3) {
      grid.classList.add('grid-3');
      allTiles.forEach(tile => {
        tile.style.setProperty('display', 'flex', 'important');
        const vid = tile.querySelector('video');
        if (vid && vid.paused) vid.play().catch(e => { });
      });
    } else if (totalCount === 4) {
      grid.classList.add('grid-4');
      allTiles.forEach(tile => {
        tile.style.setProperty('display', 'flex', 'important');
        const vid = tile.querySelector('video');
        if (vid && vid.paused) vid.play().catch(e => { });
      });
    } else if (totalCount <= 8) {
      grid.classList.add('grid-8');
      allTiles.forEach(tile => {
        tile.style.setProperty('display', 'flex', 'important');
        const vid = tile.querySelector('video');
        if (vid && vid.paused) vid.play().catch(e => { });
      });
    } else if (totalCount <= 12) {
      grid.classList.add('grid-12');
      allTiles.forEach(tile => {
        tile.style.setProperty('display', 'flex', 'important');
        const vid = tile.querySelector('video');
        if (vid && vid.paused) vid.play().catch(e => { });
      });
    } else {
      // 13+ participants: STRICTLY CAP AT 12 SLOTS (3 ROWS x 4 COLS)
      // Exactly 11 participant tiles + 1 overflow tile = 12 total tiles on screen!
      grid.classList.add('grid-12');
      const maxVisibleParticipantTiles = 11;
      const overflowCount = totalCount - maxVisibleParticipantTiles;

      allTiles.forEach((tile, index) => {
        const vid = tile.querySelector('video');
        if (index < maxVisibleParticipantTiles) {
          tile.style.setProperty('display', 'flex', 'important');
          // Bandwidth/CPU optimization: play video for visible tiles
          if (vid && vid.paused) vid.play().catch(e => { });
        } else {
          tile.style.setProperty('display', 'none', 'important');
          // Bandwidth/CPU optimization: pause video for hidden tiles
          if (vid && !vid.paused) vid.pause();
        }
      });

      // Append 12th slot as "+N Daha fazla" overflow tile
      const overflowTile = document.createElement('div');
      overflowTile.className = 'participant-tile overflow-tile';
      overflowTile.onclick = () => {
        if (typeof toggleSidebarTab === 'function') {
          toggleSidebarTab('participants');
        }
      };
      overflowTile.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.35rem; text-align: center;">
          <div class="overflow-count" style="font-size: 1.6rem; font-weight: 800; color: #5b5fc7;">+${overflowCount}</div>
          <div class="overflow-label" style="font-size: 0.82rem; font-weight: 700; color: #475569;">Daha fazla</div>
        </div>
      `;
      grid.appendChild(overflowTile);
    }
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

  renderChatMessage(data) {
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

    if (!isSelf && typeof activeTab !== 'undefined' && activeTab !== 'chat') {
      if (typeof unreadChatCount !== 'undefined') {
        unreadChatCount++;
        if (typeof updateUnreadBadge === 'function') updateUnreadBadge();
      }
    }
  },

  broadcastNote(content) {
    if (!content || !content.trim()) return;
    const authorName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Yönetici';
    const notePayload = {
      type: 'new-note',
      content: content.trim(),
      author: authorName,
      created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    this.sendSignal(notePayload);
    this.renderLiveNote(notePayload);
    Notifications.show('Toplantı notu herkese canlı olarak yayınlandı.', 'success', 'Yayınlandı');
  },

  renderLiveNote(data) {
    const containers = [
      document.getElementById('notesFeedContainer'),
      document.getElementById('sidebarNotesFeedContainer')
    ];

    containers.forEach(container => {
      if (!container) return;

      const placeholder = container.querySelector('div[style*="dashed"]');
      if (placeholder) placeholder.style.display = 'none';

      const card = document.createElement('div');
      card.className = 'note-card';
      card.style.background = '#ffffff';
      card.style.border = '1px solid #cbd5e1';
      card.style.borderRadius = '10px';
      card.style.padding = '0.85rem';
      card.style.marginBottom = '0.65rem';
      card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';
      card.innerHTML = `
        <div style="font-size: 0.75rem; font-weight: 700; color: #4f46e5; margin-bottom: 0.3rem;">
          <i class="fas fa-bullhorn"></i> ${data.author || 'Toplantı Kararı'} • ${data.created_at || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div class="note-card-body" style="font-size: 0.88rem; color: #0f172a; line-height: 1.5; white-space: pre-wrap;">${data.content}</div>
      `;

      container.prepend(card);
    });
  },

  removePeer(remoteUserId) {
    if (this.peers[remoteUserId]) {
      this.peers[remoteUserId].close();
      delete this.peers[remoteUserId];
    }
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

  leaveMeeting() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
    if (this.socket) {
      this.socket.close();
    }
    if (typeof Notifications !== 'undefined') {
      Notifications.show("Toplantıdan başarıyla ayrıldınız.", "info", "Ayrıldınız");
    }
    setTimeout(() => {
      window.location.replace('/');
    }, 400);
  },

  endMeetingForAll() {
    if (!this.isHost) {
      this.leaveMeeting();
      return;
    }
    this.sendSignal({ type: 'end-meeting' });
    if (typeof Notifications !== 'undefined') {
      Notifications.show("Toplantı tüm katılımcılar için sonlandırılıyor.", "danger", "Sonlandırıldı");
    }
    setTimeout(() => {
      this.leaveMeeting();
    }, 600);
  },

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

  toggleCardContextMenu(event, id) {
    if (event) event.stopPropagation();
    const menu = document.getElementById(`cardContextMenu_${id}`);
    if (!menu) return;
    const isShown = (menu.style.display === 'flex');
    document.querySelectorAll('.card-context-menu').forEach(m => m.style.display = 'none');
    menu.style.display = isShown ? 'none' : 'flex';
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
      const isSelf = (p.id === this.currentUser?.id);
      const isHostUser = (p.id === this.meetingInfo?.created_by || p.role === 'host');
      const isSpeaking = !!p.isSpeaking;
      const initials = (p.name?.[0] || 'K').toUpperCase();
      const isMicMuted = !!p.isMicMuted;
      const isCameraOff = (p.isCameraOff !== false);

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
                <span style="font-size: 0.7rem; font-weight: 700; color: ${isHostUser ? '#5b5fc7' : '#616161'};">${isHostUser ? 'Toplantı Sahibi' : 'Katılımcı'}</span>
              `}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.65rem; font-size: 0.85rem;">
            <i class="fas ${isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${isMicMuted ? '#f43f5e' : '#10b981'};"></i>
            <i class="fas ${isCameraOff ? 'fa-video-slash' : 'fa-video'}" style="color: ${isCameraOff ? '#f43f5e' : '#10b981'};"></i>
            <i class="fas fa-ellipsis-v" onclick="WebRTC.toggleCardContextMenu(event, '${p.id}')" style="color: #94a3b8; cursor: pointer;" title="Seçenekler"></i>
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

  toggleFullscreen(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
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
      if (typeof Notifications !== 'undefined') {
        Notifications.show("Hoparlör çıkışı değiştirildi.", "success", "Hoparlör");
      }
    } catch (e) {
      console.warn("Hoparlör değiştirilemedi:", e);
    }
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

    // 2. Eğer kullanıcı Yönetici (Host) ise VEYA izin onaylandıysa doğrudan paylaşımı başlatır
    if (this.isHost || this.approvedScreenShare) {
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
    if (confirm("Toplantıyı herkes için sonlandırmak istediğinize emin misiniz?")) {
      this.sendSignal({ type: 'meeting-ended' });
      window.location.href = `/reports/${this.meetingInfo?.id || ''}`;
    }
  },

  endMeetingForAll() {
    this.endMeeting();
  },

  leaveMeeting() {
    this.sendSignal({ type: 'user-left', explicit: true });
    if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
    window.location.href = '/';
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

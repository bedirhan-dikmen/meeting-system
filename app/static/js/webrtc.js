/* ==========================================================================
   WEBRTC REAL-TIME VIDEO & SIGNALING MODULE
   ========================================================================== */

const WebRTC = {
  socket: null,
  meetingCode: '',
  localStream: null,
  peers: {}, // { userId: RTCPeerConnection }
  peerStreams: {},
  meetingInfo: null,
  startTime: null,
  timerInterval: null,

  isHost: false,
  currentUser: null,

  isMicMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  screenTrack: null,

  iceServers: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  },

  pendingCandidates: {}, // { userId: [candidates] }

  async joinRoom(meetingCode, existingStream = null, isMicMuted = false, isCameraOff = false) {
    this.meetingCode = meetingCode;
    this.currentUser = Auth.getUser();
    this.isMicMuted = isMicMuted;
    this.isCameraOff = isCameraOff;

    // Fetch Meeting Details
    await this.fetchMeetingInfo();
    await this.loadExistingNotes();

    // Setup Local Stream
    if (existingStream) {
      this.localStream = existingStream;
    } else {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: !this.isCameraOff,
          audio: !this.isMicMuted
        });
      } catch (err) {
        console.warn("Medya akışı alınamadı, sessiz/görüntüsüz bağlanılıyor:", err);
      }
    }

    this.renderLocalTile();
    this.connectWebSocket();
    this.startTimer();
    this.bindRoomControls();
  },

  async loadExistingNotes() {
    if (!this.meetingInfo?.id) return;
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
      const response = await fetch(`/api/v1/meetings/code/${this.meetingCode}`, {
        headers: Auth.getAuthHeaders()
      });
      if (response.ok) {
        this.meetingInfo = await response.json();
        this.isHost = (this.currentUser && this.meetingInfo.created_by === this.currentUser.id);
        
        const titleEl = document.getElementById('roomTitle');
        if (titleEl) titleEl.textContent = this.meetingInfo.title;

        // Toplantı Sahibi Paneli Kontrollerini Göster
        const hostPanel = document.getElementById('hostControlsPanel');
        if (hostPanel) hostPanel.style.display = this.isHost ? 'flex' : 'none';

        const hostNoteSection = document.getElementById('hostNoteSection');
        if (hostNoteSection) hostNoteSection.style.display = this.isHost ? 'block' : 'none';

        const hostAdminActions = document.getElementById('hostAdminActions');
        if (hostAdminActions) hostAdminActions.style.display = this.isHost ? 'block' : 'none';

        const btnEndBar = document.getElementById('btnEndMeetingHostBar');
        if (btnEndBar) btnEndBar.style.display = this.isHost ? 'inline-flex' : 'none';
      }
    } catch (e) {
      console.warn("Toplantı detayları alınamadı:", e);
    }
  },

  participantsMap: {}, // { userId: { id, name, avatar_url, role, isMicMuted, isCameraOff } }

  connectWebSocket() {
    const token = Auth.getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/signaling/ws/${this.meetingCode}?token=${token}`;

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

      this.sendSignal({
        type: 'user-joined',
        user_info: {
          id: this.currentUser?.id,
          name: myName,
          avatar_url: this.currentUser?.avatar_url,
          role: this.isHost ? 'admin' : 'user'
        }
      });
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

    this.socket.onclose = () => {
      this.updateConnectionBadge('offline', 'Bağlantı Kesildi');
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
            if (u && u.id) {
              this.participantsMap[u.id] = u;
            }
          });
          this.renderParticipantsList();
          this.renderAllParticipantTiles();
          for (const u of data.users) {
            if (u.id && u.id !== this.currentUser?.id) {
              // Deterministik Initiator: Id'si küçük olan taraf teklif (offer) gönderir (Çifte teklif çakışmasını engeller)
              const isInitiator = Boolean(this.currentUser?.id && u.id && this.currentUser.id < u.id);
              await this.createPeerConnection(u.id, isInitiator);
            }
          }
        }
        if (data.active_screen_share && data.active_screen_share.presenter_id) {
          this.screenSharePresenterId = data.active_screen_share.presenter_id;
          const presenterStream = this.peerStreams[this.screenSharePresenterId] || null;
          this.enableScreenShareLayout(data.active_screen_share.presenter_name || 'Katılımcı', presenterStream);
        }
        break;

      case 'user-joined':
        if (data.user_info) {
          const joinedId = data.user_info.id || senderId;
          this.participantsMap[joinedId] = data.user_info;
          this.renderParticipantsList();
          this.renderRemoteTile(joinedId);

          if (joinedId && joinedId !== this.currentUser?.id) {
            const isInitiator = Boolean(this.currentUser?.id && joinedId && this.currentUser.id < joinedId);
            await this.createPeerConnection(joinedId, isInitiator);
          }
        }
        Notifications.show(`${data.user_info?.name || 'Bir katılımcı'} odaya katıldı.`, 'info', 'Toplantı Katılımı');
        break;

      case 'user-state-update':
        if (senderId && this.participantsMap[senderId]) {
          if (data.isMicMuted !== undefined) this.participantsMap[senderId].isMicMuted = data.isMicMuted;
          if (data.isCameraOff !== undefined) this.participantsMap[senderId].isCameraOff = data.isCameraOff;
          this.renderParticipantsList();
          this.renderRemoteTile(senderId);
        }
        break;

      case 'video-offer':
        if (senderId) {
          const pc = await this.createPeerConnection(senderId, false);

          // Teklif Çakışması (Offer Glare) Kontrolü
          if (pc.signalingState !== 'stable') {
            const isPolite = Boolean(this.currentUser?.id && senderId && this.currentUser.id > senderId);
            if (!isPolite) {
              console.warn(`[WebRTC] Teklif çakışması: Kibar olmayan taraf ${senderId} gelen offer'ı göz ardı ediyor.`);
              return;
            } else {
              console.warn(`[WebRTC] Teklif çakışması: Kibar taraf yerel offer'ı geri alıyor (rollback).`);
              await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
            }
          }

          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          await this.processPendingCandidates(senderId);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          this.sendSignal({
            type: 'video-answer',
            target_id: senderId,
            sdp: answer
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

      case 'screen-share-request-response':
        if (data.target_id === this.currentUser?.id) {
          if (data.approved) {
            Notifications.show("Yönetici ekran paylaşımı talebinizi onayladı!", "success", "Ekran Paylaşımı İzni");
            this.startScreenShareFlow();
          } else {
            Notifications.show("Yönetici ekran paylaşımı talebinizi reddetti.", "error", "Ekran Paylaşımı İzni");
          }
        }
        break;

      case 'screen-share-start':
        this.screenSharePresenterId = senderId;
        if (this.participantsMap[senderId]) {
          this.participantsMap[senderId].isCameraOff = false;
        }
        const presenterStream = this.peerStreams[senderId]
          || (document.getElementById(`remoteVideo_${senderId}`)?.srcObject)
          || null;
        this.enableScreenShareLayout(data.presenter_name || 'Katılımcı', presenterStream);
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
        if (senderId && this.participantsMap[senderId]) {
          delete this.participantsMap[senderId];
          this.renderParticipantsList();
        }
        Notifications.show(`Bir katılımcı toplantıdan ayrıldı.`, 'info', 'Ayrıldı');
        this.removePeer(senderId);
        break;

      case 'host-kick':
        if (data.target_id === this.currentUser?.id) {
          alert("Toplantı yöneticisi tarafından toplantıdan çıkarıldınız.");
          window.location.href = '/meetings';
        }
        break;

      case 'meeting-ended':
        alert("Toplantı yönetici tarafından sonlandırıldı.");
        window.location.href = `/reports/${this.meetingInfo?.id || ''}`;
        break;
    }
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
      await pc.setLocalDescription(offer);
      this.sendSignal({
        type: 'video-offer',
        target_id: remoteUserId,
        sdp: offer
      });
    } catch (e) {
      console.warn(`[WebRTC] Yeniden müzakere (renegotiate) hatası (${remoteUserId}):`, e);
    }
  },

  async createPeerConnection(remoteUserId, isInitiator) {
    if (this.peers[remoteUserId]) return this.peers[remoteUserId];

    const pc = new RTCPeerConnection(this.iceServers);
    this.peers[remoteUserId] = pc;

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        if (track.kind === 'video' && this.isScreenSharing && this.screenTrack) {
          pc.addTrack(this.screenTrack, this.localStream);
        } else {
          pc.addTrack(track, this.localStream);
        }
      });
    } else if (this.isScreenSharing && this.screenTrack) {
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

    // Eğer şu an ekran paylaşılıyorsa, video sender'ı ekran track'i ile güncelle
    if (this.isScreenSharing && this.screenTrack) {
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video' || s.kind === 'video');
      if (videoSender) {
        videoSender.replaceTrack(this.screenTrack).catch(e => console.warn("Ekran track yerleştirme uyarısı:", e));
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
      console.log(`[WebRTC] Track alındı (${remoteUserId}):`, event.track.kind);
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      this.peerStreams[remoteUserId] = remoteStream;

      if (event.track.kind === 'video' && this.participantsMap[remoteUserId]) {
        this.participantsMap[remoteUserId].isCameraOff = false;
      }

      this.renderRemoteTile(remoteUserId, remoteStream);

      // Ekran paylaşımı sunucusu bu katılımcı ise paylaşım alanındaki videoyu güncelle
      if (this.screenSharePresenterId === remoteUserId) {
        const shareVid = document.getElementById('screenShareVideo');
        if (shareVid) {
          shareVid.srcObject = remoteStream;
          shareVid.play().catch(e => console.warn('Ekran paylaşımı video oynatılamadı:', e));
        }
      }
    };

    // Connection state log
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.removePeer(remoteUserId);
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal({
        type: 'video-offer',
        target_id: remoteUserId,
        sdp: offer
      });
    }

    return pc;
  },

  renderLocalTile() {
    const activeContainer = (this.isScreenSharing || document.getElementById('screenShareArea')?.style.display === 'flex')
      ? document.getElementById('topCarouselBar')
      : document.getElementById('videoGrid');

    if (!activeContainer) return;

    let tile = document.getElementById('localVideoTile');
    if (!tile) {
      tile = document.createElement('div');
      tile.id = 'localVideoTile';
      tile.className = 'participant-tile';
      activeContainer.appendChild(tile);
    } else if (tile.parentElement !== activeContainer) {
      activeContainer.appendChild(tile);
    }

    const initials = (this.currentUser?.first_name?.[0] || 'S') + (this.currentUser?.last_name?.[0] || 'EN');
    const name = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Siz';
    const avatarUrl = this.currentUser?.avatar_url;

    tile.innerHTML = `
      <video id="localVideo" autoplay playsinline muted></video>
      <div id="localAvatar" class="avatar-placeholder" style="display: ${this.isCameraOff ? 'flex' : 'none'};">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : initials.toUpperCase()}
      </div>
      <div class="tile-overlay">
        <span title="${name} (Siz)">
          <strong style="color: #fff; font-weight: 700;">${name}</strong>
          <span style="font-size: 0.72rem; color: var(--accent-cyan); opacity: 0.9;">(Siz)</span>
        </span>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-left: auto;">
          <i id="localMicStatusIcon" class="fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${this.isMicMuted ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-size: 0.9rem;"></i>
        </div>
      </div>
    `;

    const videoEl = document.getElementById('localVideo');
    if (videoEl && this.localStream) {
      videoEl.srcObject = this.localStream;
      videoEl.style.display = this.isCameraOff ? 'none' : 'block';
    }
  },

  renderRemoteTile(remoteUserId, stream = null) {
    const activeContainer = (document.getElementById('screenShareArea')?.style.display === 'flex')
      ? document.getElementById('topCarouselBar')
      : document.getElementById('videoGrid');

    if (!activeContainer) return;

    const info = this.participantsMap[remoteUserId] || { name: `Katılımcı (${remoteUserId.slice(0, 5)})` };
    const name = info.name || 'Katılımcı';
    const initials = (name[0] || 'K').toUpperCase();
    const avatarUrl = info.avatar_url;
    const isCameraOff = info.isCameraOff || false;
    const isMicMuted = info.isMicMuted || false;
    const isHostUser = (remoteUserId === this.meetingInfo?.created_by);

    let tile = document.getElementById(`remoteTile_${remoteUserId}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.id = `remoteTile_${remoteUserId}`;
      tile.className = 'participant-tile';
      activeContainer.appendChild(tile);
    } else if (tile.parentElement !== activeContainer) {
      activeContainer.appendChild(tile);
    }

    tile.innerHTML = `
      <video id="remoteVideo_${remoteUserId}" autoplay playsinline style="display: ${isCameraOff ? 'none' : 'block'};"></video>
      <div id="remoteAvatar_${remoteUserId}" class="avatar-placeholder" style="display: ${isCameraOff ? 'flex' : 'none'};">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : initials}
      </div>
      <div class="tile-overlay">
        <span title="${name}">
          <strong style="color: #fff; font-weight: 700; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</strong>
          <span class="role-badge ${isHostUser ? 'role-badge-admin' : 'role-badge-user'}" style="font-size: 0.6rem; padding: 0.1rem 0.35rem;">${isHostUser ? 'Yönetici' : 'Katılımcı'}</span>
        </span>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-left: auto;">
          <i class="fas ${isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${isMicMuted ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-size: 0.9rem;"></i>
          ${this.isHost ? `
            <button onclick="WebRTC.kickParticipant('${remoteUserId}')" class="btn btn-danger" style="padding: 0.15rem 0.35rem; font-size: 0.65rem;" title="Çıkar">
              <i class="fas fa-user-minus"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;

    const videoEl = document.getElementById(`remoteVideo_${remoteUserId}`);
    const streamToUse = stream || this.peerStreams[remoteUserId];
    if (videoEl && streamToUse) {
      videoEl.srcObject = streamToUse;
      videoEl.play().catch(e => console.warn("Uzaktan video oynatma başlatılamadı:", e));
    }
  },

  renderAllParticipantTiles() {
    Object.keys(this.participantsMap).forEach(uid => {
      if (uid && uid !== this.currentUser?.id) {
        this.renderRemoteTile(uid);
      }
    });
  },

  setRemoteStream(remoteUserId, stream) {
    const videoEl = document.getElementById(`remoteVideo_${remoteUserId}`);
    if (videoEl) {
      videoEl.srcObject = stream;
    }
  },

  enableScreenShareLayout(presenterName, stream) {
    const topBar = document.getElementById('topCarouselBar');
    const shareArea = document.getElementById('screenShareArea');
    const grid = document.getElementById('videoGrid');

    if (!topBar || !shareArea || !grid) return;

    topBar.style.display = 'flex';
    shareArea.style.display = 'flex';
    grid.style.display = 'none';

    // Katilimci kartlarini ust karuselse sorunsuz tasi
    const tiles = document.querySelectorAll('.participant-tile');
    tiles.forEach(tile => topBar.appendChild(tile));

    const presenterEl = document.getElementById('screenSharePresenterName');
    if (presenterEl) presenterEl.textContent = `${presenterName} tarafından ekran paylaşılıyor`;

    if (!stream && this.screenSharePresenterId) {
      stream = this.peerStreams[this.screenSharePresenterId] || (document.getElementById(`remoteVideo_${this.screenSharePresenterId}`)?.srcObject);
    }

    const shareVid = document.getElementById('screenShareVideo');
    if (shareVid && stream) {
      shareVid.muted = (this.screenSharePresenterId === this.currentUser?.id);
      shareVid.srcObject = stream;
      shareVid.play().then(() => {
        console.log("[WebRTC] Ekran paylaşımı videosu oynatılıyor.");
      }).catch(e => {
        console.warn("[WebRTC] Ekran paylaşımı video oynatma hatası:", e);
      });
    }
  },

  disableScreenShareLayout() {
    const topBar = document.getElementById('topCarouselBar');
    const shareArea = document.getElementById('screenShareArea');
    const grid = document.getElementById('videoGrid');

    if (!topBar || !shareArea || !grid) return;

    topBar.style.display = 'none';
    shareArea.style.display = 'none';
    grid.style.display = 'grid';

    const shareVid = document.getElementById('screenShareVideo');
    if (shareVid) shareVid.srcObject = null;

    // Tüm yerel ve uzaktaki katılımcı kartlarını ana video ızgarasında yeniden çiz
    this.renderLocalTile();
    this.renderAllParticipantTiles();
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
    const container = document.getElementById('notesFeedContainer');
    if (!container) return;

    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <div class="note-card-header">
        <span><i class="fas fa-user-edit" style="color: var(--accent-amber);"></i> <strong>${data.author || 'Yönetici'}</strong></span>
        <span>${data.created_at || 'Şimdi'}</span>
      </div>
      <div class="note-card-body">${data.content}</div>
    `;

    container.prepend(card);
  },

  removePeer(remoteUserId) {
    if (this.peers[remoteUserId]) {
      this.peers[remoteUserId].close();
      delete this.peers[remoteUserId];
    }
    const tile = document.getElementById(`remoteTile_${remoteUserId}`);
    if (tile) tile.remove();
  },

  toggleMic() {
    this.isMicMuted = !this.isMicMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);
    }
    const btn = document.getElementById('btnRoomMic');
    const micIcon = document.getElementById('localMicStatusIcon');

    if (btn) btn.classList.toggle('active-off', this.isMicMuted);
    if (micIcon) {
      micIcon.className = `fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}`;
      micIcon.style.color = this.isMicMuted ? 'var(--accent-rose)' : 'var(--accent-emerald)';
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

  toggleCamera() {
    this.isCameraOff = !this.isCameraOff;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
    }
    const btn = document.getElementById('btnRoomCam');
    const videoEl = document.getElementById('localVideo');
    const avatarEl = document.getElementById('localAvatar');

    if (btn) btn.classList.toggle('active-off', this.isCameraOff);
    if (videoEl) videoEl.style.display = this.isCameraOff ? 'none' : 'block';
    if (avatarEl) avatarEl.style.display = this.isCameraOff ? 'flex' : 'none';

    if (this.currentUser?.id && this.participantsMap[this.currentUser.id]) {
      this.participantsMap[this.currentUser.id].isCameraOff = this.isCameraOff;
      this.renderParticipantsList();
    }

    this.sendSignal({
      type: 'user-state-update',
      isMicMuted: this.isMicMuted,
      isCameraOff: this.isCameraOff
    });
  },

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      this.stopScreenShare();
      return;
    }

    const fullName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Katılımcı';

    // 1. Eğer halihazırda başkası ekran paylaşıyorsa bilgi ver
    if (this.screenSharePresenterId && this.screenSharePresenterId !== this.currentUser?.id) {
      Notifications.show("Toplantıda aktif bir ekran paylaşımı bulunuyor. Aynı anda yalnızca tek bir paylaşım yapılabilir.", "warning", "Ekran Paylaşımı");
      return;
    }

    // 2. Eğer kullanıcı Yönetici (Host) ise doğrudan paylaşımı başlatır
    if (this.isHost) {
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

  async startScreenShareFlow() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });
      this.screenTrack = screenStream.getVideoTracks()[0];

      const fullName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Siz';
      this.screenSharePresenterId = this.currentUser?.id;

      // Önce yerel ekran düzenini aktif et
      this.enableScreenShareLayout(fullName, screenStream);

      // Tüm akran bağlantılarında (peers) video track'ini ekran track'i ile değiştir veya ekle
      for (const [remoteUserId, pc] of Object.entries(this.peers)) {
        const senders = pc.getSenders();
        let videoSender = senders.find(s => s.track?.kind === 'video');
        if (!videoSender) {
          videoSender = senders.find(s => !s.track || s.kind === 'video');
        }

        if (videoSender) {
          await videoSender.replaceTrack(this.screenTrack);
        } else {
          pc.addTrack(this.screenTrack, screenStream);
        }

        // Bağlantı kararlıysa (stable) SDP yeniden müzakere et
        if (pc.signalingState === 'stable') {
          await this.renegotiatePeer(remoteUserId);
        }
      }

      this.sendSignal({
        type: 'screen-share-start',
        presenter_name: fullName
      });

      this.isScreenSharing = true;
      document.getElementById('btnScreenShare')?.classList.add('active-off');

      this.screenTrack.onended = () => this.stopScreenShare();
    } catch (e) {
      console.warn("Ekran paylaşımı iptal edildi veya hata:", e);
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
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <div style="width: 40px; height: 40px; border-radius: 50%; background: rgba(6, 182, 212, 0.15); display: flex; align-items: center; justify-content: center; color: var(--accent-cyan);">
          <i class="fas fa-desktop" style="font-size: 1.1rem;"></i>
        </div>
        <div>
          <strong style="display: block; font-size: 0.9rem; color: #fff;">Ekran Paylaşımı İzin Talebi</strong>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">${requesterName} ekranını tüm katılımcılarla paylaşmak istiyor.</span>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem; margin-left: auto;">
        <button onclick="WebRTC.respondToScreenShareRequest('${requesterId}', true)" class="btn btn-primary" style="padding: 0.45rem 0.9rem; font-size: 0.8rem; background: var(--accent-emerald); border: none;">
          <i class="fas fa-check"></i> Onayla & İzin Ver
        </button>
        <button onclick="WebRTC.respondToScreenShareRequest('${requesterId}', false)" class="btn btn-secondary" style="padding: 0.45rem 0.9rem; font-size: 0.8rem; background: rgba(255,255,255,0.1);">
          <i class="fas fa-times"></i> Reddet
        </button>
      </div>
    `;
  },

  respondToScreenShareRequest(requesterId, approved) {
    const dialog = document.getElementById('screenShareApprovalToast');
    if (dialog) dialog.style.display = 'none';

    this.sendSignal({
      type: 'screen-share-request-response',
      target_id: requesterId,
      approved: approved
    });
  },

  async stopScreenShare() {
    if (this.screenTrack) {
      this.screenTrack.stop();
      this.screenTrack = null;
    }

    const cameraTrack = (this.localStream && !this.isCameraOff) ? this.localStream.getVideoTracks()[0] : null;

    for (const [remoteUserId, pc] of Object.entries(this.peers)) {
      const senders = pc.getSenders();
      const videoSender = senders.find(s => s.track?.kind === 'video' || s.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(cameraTrack || null);
      }
      if (pc.signalingState === 'stable') {
        await this.renegotiatePeer(remoteUserId);
      }
    }

    this.screenSharePresenterId = null;
    this.disableScreenShareLayout();

    this.renderLocalTile();

    this.sendSignal({ type: 'screen-share-stop' });

    this.isScreenSharing = false;
    document.getElementById('btnScreenShare')?.classList.remove('active-off');
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

  leaveMeeting() {
    if (confirm("Toplantıdan ayrılmak istiyor musunuz?")) {
      this.sendSignal({ type: 'user-left' });
      if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
      window.location.href = '/meetings';
    }
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
    document.getElementById('btnRoomMic')?.addEventListener('click', () => this.toggleMic());
    document.getElementById('btnRoomCam')?.addEventListener('click', () => this.toggleCamera());
    document.getElementById('btnScreenShare')?.addEventListener('click', () => this.toggleScreenShare());
    document.getElementById('btnLeaveRoom')?.addEventListener('click', () => this.leaveMeeting());
    document.getElementById('btnEndMeetingHost')?.addEventListener('click', () => this.endMeeting());
    document.getElementById('btnEndMeetingHostBar')?.addEventListener('click', () => this.endMeeting());
  }
};

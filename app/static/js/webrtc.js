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
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ],
    iceCandidatePoolSize: 10
  },

  optimizeSDP(sdp) {
    if (!sdp) return sdp;
    // Low latency & high bitrate Opus HD audio setup (128 kbps, 48kHz, stereo hint)
    return sdp.replace(/a=fmtp:111 (.*)/g, 'a=fmtp:111 $1;maxaveragebitrate=128000;stereo=1;sprop-stereo=1;cbr=0;usedtx=1');
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
    }

    this.renderLocalTile();
    this.updateMicUI();
    this.updateCameraUI();
    this.connectWebSocket();
    this.startTimer();
    this.bindRoomControls();
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

          const isCreator = (this.currentUser && this.meetingInfo && String(this.meetingInfo.created_by) === String(this.currentUser.id));
          const isAdmin = (this.currentUser && (this.currentUser.role === 'admin' || this.currentUser.is_superuser));

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
        if (hostPanel) hostPanel.style.display = this.isHost ? 'flex' : 'none';

        const hostNoteSection = document.getElementById('hostNoteSection');
        if (hostNoteSection) hostNoteSection.style.display = this.isHost ? 'block' : 'none';

        const hostAdminActions = document.getElementById('hostAdminActions');
        if (hostAdminActions) hostAdminActions.style.display = this.isHost ? 'block' : 'none';

        const btnEndBar = document.getElementById('btnEndMeetingHostBar');
        if (btnEndBar) btnEndBar.style.display = this.isHost ? 'inline-flex' : 'none';

        const btnEndPopover = document.getElementById('btnEndMeetingHostPopover');
        if (btnEndPopover) btnEndPopover.style.display = this.isHost ? 'flex' : 'none';
      }
    } catch (e) {
      console.warn("Toplantı detayları alınamadı:", e);
    }
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

      this.sendSignal({
        type: 'user-joined',
        user_info: {
          id: this.currentUser?.id,
          name: myName,
          avatar_url: this.currentUser?.avatar_url,
          role: this.isHost ? 'admin' : (this.currentUser?.role || 'user')
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
            if (u && u.id) {
              this.participantsMap[u.id] = {
                id: u.id,
                name: u.name || 'Katılımcı',
                avatar_url: u.avatar_url,
                role: u.role || 'user',
                isMicMuted: u.isMicMuted !== undefined ? u.isMicMuted : true,
                isCameraOff: u.isCameraOff !== undefined ? u.isCameraOff : true
              };
            }
          });
          this.renderParticipantsList();
          this.renderAllParticipantTiles();
          this.reflowVideoGrid();

          for (const u of data.users) {
            if (u.id && u.id !== this.currentUser?.id) {
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
          this.participantsMap[joinedId] = {
            id: joinedId,
            name: data.user_info.name || 'Katılımcı',
            avatar_url: data.user_info.avatar_url,
            role: data.user_info.role || 'user',
            isMicMuted: data.user_info.isMicMuted !== undefined ? data.user_info.isMicMuted : true,
            isCameraOff: data.user_info.isCameraOff !== undefined ? data.user_info.isCameraOff : true
          };
          this.renderParticipantsList();
          this.renderRemoteTile(joinedId);
          this.reflowVideoGrid();

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
          this.reflowVideoGrid();
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
            Notifications.showAction(
              "Yönetici ekran paylaşımı talebinizi onayladı! Ekranınızı seçip yayını başlatmak için butona tıklayın.",
              "Ekranı Paylaş",
              () => this.startScreenShareFlow(),
              "success",
              "Ekran Paylaşımı İzni"
            );
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
        const leavingId = senderId || data.user_info?.id;
        if (leavingId) {
          delete this.participantsMap[leavingId];
          delete this.peerStreams[leavingId];
          this.removePeer(leavingId);
          this.renderParticipantsList();
          this.reflowVideoGrid();
          Notifications.show(`Bir katılımcı toplantıdan ayrıldı.`, 'info', 'Ayrıldı');
        }
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

  async createPeerConnection(remoteUserId, isInitiator) {
    if (this.peers[remoteUserId]) return this.peers[remoteUserId];

    const pc = new RTCPeerConnection(this.iceServers);
    this.peers[remoteUserId] = pc;

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

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
      const remoteStream = event.streams[0] || new MediaStream([event.track]);

      if (event.track.kind !== 'video') {
        // Ses kanalı
        this.peerStreams[remoteUserId] = remoteStream;
        return;
      }

      const streamId = (event.streams[0]?.id || '').toLowerCase();
      const trackLabel = (event.track?.label || '').toLowerCase();

      // Ekran paylaşımı tespiti (Etikette/ID'de anahtar kelimeler veya aktif paylaşım yapan kullanıcı olması)
      const isExplicitScreen = streamId.includes('screen') || streamId.includes('display') || 
                               trackLabel.includes('screen') || trackLabel.includes('display') || 
                               trackLabel.includes('window') || trackLabel.includes('monitor') || 
                               trackLabel.includes('desktop') || trackLabel.includes('entire');

      const isPresenter = (String(this.screenSharePresenterId) === String(remoteUserId));
      const existingWebcamStream = this.peerStreams[remoteUserId];
      const isSecondVideoStream = existingWebcamStream && existingWebcamStream.id !== remoteStream.id;

      if (isPresenter || isExplicitScreen || isSecondVideoStream) {
        console.log(`[WebRTC] Ekran paylaşımı akışı bağlandı (${remoteUserId})`);
        const shareVid = document.getElementById('screenShareVideo');
        if (shareVid) {
          shareVid.srcObject = remoteStream;
          shareVid.muted = (String(remoteUserId) === String(this.currentUser?.id));
          shareVid.play().catch(e => console.warn('[WebRTC] Ekran paylaşımı oynatma hatası:', e));
        }

        const presenterName = this.participantsMap[remoteUserId]?.name || 'Katılımcı';
        this.enableScreenShareLayout(presenterName, remoteStream);
        return;
      }

      // Kamera/Mikrofon akışını katılımcı kartına bağla
      this.peerStreams[remoteUserId] = remoteStream;

      if (this.participantsMap[remoteUserId]) {
        this.participantsMap[remoteUserId].isCameraOff = false;
      }

      this.renderRemoteTile(remoteUserId, remoteStream);
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
      <video id="localVideo" autoplay playsinline muted style="display: ${this.isCameraOff ? 'none' : 'block'}; width: 100%; height: 100%; object-fit: cover;"></video>
      <div id="localAvatar" style="display: ${this.isCameraOff ? 'flex' : 'none'}; flex-direction: column; align-items: center; justify-content: center; width: 84px; height: 84px; border-radius: 50%; background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); color: #4f46e5; border: 2px solid #ffffff; font-size: 2.2rem; font-weight: 800; box-shadow: 0 4px 15px rgba(79, 70, 229, 0.15); margin: auto;">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : initials.toUpperCase()}
      </div>
      <div class="tile-overlay" style="position: absolute; bottom: 0.75rem; left: 0.75rem; right: 0.75rem; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(6px); border-radius: 8px; padding: 0.35rem 0.75rem; display: flex; align-items: center; justify-content: space-between; color: #fff;">
        <span title="${name} (Siz)">
          <strong style="color: #fff; font-weight: 700; font-size: 0.85rem;">${name}</strong>
          <span style="font-size: 0.72rem; color: #38bdf8; opacity: 0.9;">(Siz)</span>
        </span>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <i id="localMicStatusIcon" class="fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${this.isMicMuted ? '#f43f5e' : '#10b981'}; font-size: 0.85rem;"></i>
        </div>
      </div>
    `;

    const videoEl = document.getElementById('localVideo');
    if (videoEl && this.localStream) {
      videoEl.srcObject = this.localStream;
      videoEl.style.display = this.isCameraOff ? 'none' : 'block';
    }
    this.reflowVideoGrid();
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
    const isCameraOff = (info.isCameraOff !== false);
    const isMicMuted = (info.isMicMuted !== false);
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
      <video id="remoteVideo_${remoteUserId}" autoplay playsinline style="display: ${isCameraOff ? 'none' : 'block'}; width: 100%; height: 100%; object-fit: cover;"></video>
      <div id="remoteAvatar_${remoteUserId}" style="display: ${isCameraOff ? 'flex' : 'none'}; flex-direction: column; align-items: center; justify-content: center; width: 84px; height: 84px; border-radius: 50%; background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); color: #4f46e5; border: 2px solid #ffffff; font-size: 2.2rem; font-weight: 800; box-shadow: 0 4px 15px rgba(79, 70, 229, 0.15); margin: auto;">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : initials}
      </div>
      <div class="tile-overlay" style="position: absolute; bottom: 0.75rem; left: 0.75rem; right: 0.75rem; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(6px); border-radius: 8px; padding: 0.35rem 0.75rem; display: flex; align-items: center; justify-content: space-between; color: #fff;">
        <span title="${name}">
          <strong style="color: #fff; font-weight: 700; font-size: 0.85rem; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</strong>
          <span class="role-badge ${isHostUser ? 'role-badge-admin' : 'role-badge-user'}" style="font-size: 0.6rem; padding: 0.1rem 0.35rem;">${isHostUser ? 'Yönetici' : 'Katılımcı'}</span>
        </span>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-left: auto;">
          <i class="fas ${isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${isMicMuted ? '#f43f5e' : '#10b981'}; font-size: 0.85rem;"></i>
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

    this.reflowVideoGrid();
  },

  renderAllParticipantTiles() {
    Object.keys(this.participantsMap).forEach(uid => {
      if (uid && uid !== this.currentUser?.id) {
        this.renderRemoteTile(uid);
      }
    });
    this.reflowVideoGrid();
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

  enableScreenShareLayout(presenterName, stream) {
    const topBar = document.getElementById('topCarouselBar');
    const shareArea = document.getElementById('screenShareArea');
    const grid = document.getElementById('videoGrid');

    if (!topBar || !shareArea || !grid) return;

    topBar.style.display = 'flex';
    shareArea.style.display = 'flex';
    grid.style.display = 'none';

    // Katılımcı kartlarını üst karuselle sorunsuz taşı
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

    // Tüm kartları tekrar ana video ızgarasına taşı
    const tiles = topBar.querySelectorAll('.participant-tile');
    tiles.forEach(tile => grid.appendChild(tile));

    // Yerel ve uzaktaki katılımcı kartlarını yeniden hesapla
    this.renderLocalTile();
    this.renderAllParticipantTiles();
    this.reflowVideoGrid();
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

  updateMicUI() {
    const mainBtn = document.getElementById('btnRoomMicMain') || document.getElementById('btnRoomMic');
    const mainIcon = document.getElementById('btnRoomMicIcon');
    const micIcon = document.getElementById('localMicStatusIcon');

    if (mainBtn) {
      if (this.isMicMuted) {
        mainBtn.classList.add('muted-off');
      } else {
        mainBtn.classList.remove('muted-off');
      }
    }
    if (mainIcon) {
      mainIcon.className = `fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}`;
    }
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
    const mainBtn = document.getElementById('btnRoomCamMain') || document.getElementById('btnRoomCam');
    const mainIcon = document.getElementById('btnRoomCamIcon');
    const videoEl = document.getElementById('localVideo');
    const avatarEl = document.getElementById('localAvatar');

    if (mainBtn) {
      if (this.isCameraOff) {
        mainBtn.classList.add('muted-off');
      } else {
        mainBtn.classList.remove('muted-off');
      }
    }
    if (mainIcon) {
      mainIcon.className = `fas ${this.isCameraOff ? 'fa-video-slash' : 'fa-video'}`;
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

  async switchVideoDevice(deviceId) {
    if (!deviceId) return;
    sessionStorage.setItem('meeting_cam_id', deviceId);
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

      newTrack.enabled = !this.isCameraOff;

      Object.values(this.peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.kind === 'video');
        if (sender) {
          sender.replaceTrack(newTrack);
        }
      });

      const videoEl = document.getElementById('localVideo');
      if (videoEl) {
        videoEl.srcObject = this.localStream;
        if (!this.isCameraOff) videoEl.play().catch(console.warn);
      }
      if (typeof Notifications !== 'undefined') {
        Notifications.show("Kamera cihazı değiştirildi.", "success", "Kamera");
      }
    } catch (e) {
      console.warn("Kamera değiştirilemedi:", e);
    }
  },

  async switchAudioInput(deviceId) {
    if (!deviceId) return;
    sessionStorage.setItem('meeting_mic_id', deviceId);
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

      newTrack.enabled = !this.isMicMuted;

      Object.values(this.peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio' || s.kind === 'audio');
        if (sender) {
          sender.replaceTrack(newTrack);
        }
      });

      if (typeof Notifications !== 'undefined') {
        Notifications.show("Mikrofon cihazı değiştirildi.", "success", "Mikrofon");
      }
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
    if (shareIcon) shareIcon.className = isSharing ? 'fas fa-circle-stop' : 'fas fa-arrow-up-from-bracket';
  },

  async startScreenShareFlow() {
    let screenStream = null;
    try {
      // 1. Ekran medya alımı denemesi (Standart W3C uyumlu getDisplayMedia)
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } catch (audioErr) {
        if (audioErr.name !== 'NotAllowedError' && audioErr.name !== 'AbortError') {
          console.warn("[WebRTC] Sesli ekran paylaşımı alınamadı, sadece video ile deneniyor:", audioErr);
          screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true
          });
        } else {
          throw audioErr;
        }
      }

      if (!screenStream) return;

      this.screenTrack = screenStream.getVideoTracks()[0];
      if (!this.screenTrack) {
        throw new Error("Ekran video kanalı bulunamadı.");
      }

      // 60 FPS akıcılığı için hareket ipucu ekle
      if ('contentHint' in this.screenTrack) {
        this.screenTrack.contentHint = 'motion';
      }

      const fullName = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Siz';
      this.screenSharePresenterId = this.currentUser?.id;

      // Önce yerel ekran düzenini aktif et
      this.enableScreenShareLayout(fullName, screenStream);

      // Tüm akran bağlantılarına (peers) kamera akışını bozmadan bağımsız ekran track'i ekle
      for (const [remoteUserId, pc] of Object.entries(this.peers)) {
        const senders = pc.getSenders();
        let screenSender = senders.find(s => s.track === this.screenTrack);
        if (!screenSender) {
          screenSender = pc.addTrack(this.screenTrack, screenStream);
        }

        if (screenSender) {
          try {
            const params = screenSender.getParameters() || {};
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 8000000; // 8 Mbps max bitrate for ultra-crisp 60 FPS 1080p/1440p
            params.encodings[0].maxFramerate = 60;
            params.degradationPreference = 'maintain-framerate'; // Maintain 60 FPS framerate over resolution drop
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
        presenter_name: fullName
      });

      this.isScreenSharing = true;
      this.updateScreenShareButtonState(true);

      // Tarayıcının üst menüsündeki "Paylaşımı Durdur" butonuna tıklandığında tetiklenir
      this.screenTrack.onended = () => this.stopScreenShare();

      Notifications.show("Ekran paylaşımı başlatıldı.", "success", "Ekran Paylaşımı");
    } catch (e) {
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
    if (dialog) dialog.style.display = 'none';

    this.sendSignal({
      type: 'screen-share-request-response',
      target_id: requesterId,
      approved: approved
    });
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
        <strong>Misafir Katılım Talebi</strong>
        <span><b>${guestName}</b> toplantı odasına katılmak için onay bekliyor.</span>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="WebRTC.respondToGuestRequest('${guestId}', true)">
          <i class="fas fa-check"></i> Kabul Et
        </button>
        <button class="btn-reject" onclick="WebRTC.respondToGuestRequest('${guestId}', false)">
          <i class="fas fa-times"></i> Reddet
        </button>
      </div>
    `;
  },

  respondToGuestRequest(guestId, approved) {
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
    if (oldScreenTrack) {
      oldScreenTrack.stop();
      this.screenTrack = null;
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
      if (pc.signalingState === 'stable') {
        await this.renegotiatePeer(remoteUserId);
      }
    }

    this.screenSharePresenterId = null;
    this.disableScreenShareLayout();

    this.renderLocalTile();

    this.sendSignal({ type: 'screen-share-stop' });

    this.isScreenSharing = false;
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

  reflowVideoGrid() {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;
    const tiles = grid.querySelectorAll('.participant-tile');
    const count = tiles.length;
    if (count <= 1) {
      grid.style.gridTemplateColumns = '1fr';
    } else if (count === 2) {
      grid.style.gridTemplateColumns = '1fr 1fr';
    } else if (count <= 4) {
      grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    } else {
      grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
    }
  },

  async switchVideoDevice(deviceId) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: !this.isMicMuted
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (this.localStream) {
        const oldTrack = this.localStream.getVideoTracks()[0];
        if (oldTrack) this.localStream.removeTrack(oldTrack);
        this.localStream.addTrack(newTrack);
      }
      const localVid = document.getElementById('localVideo');
      if (localVid) localVid.srcObject = this.localStream;
      for (const pc of Object.values(this.peers)) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newTrack);
      }
      Notifications.show("Kamera cihazı başarıyla değiştirildi.", "success", "Cihaz Değişimi");
    } catch (e) {
      console.warn("Kamera değiştirme hatası:", e);
    }
  },

  async switchAudioInput(deviceId) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (this.localStream) {
        const oldTrack = this.localStream.getAudioTracks()[0];
        if (oldTrack) this.localStream.removeTrack(oldTrack);
        this.localStream.addTrack(newTrack);
      }
      for (const pc of Object.values(this.peers)) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) await sender.replaceTrack(newTrack);
      }
      Notifications.show("Mikrofon cihazı başarıyla değiştirildi.", "success", "Cihaz Değişimi");
    } catch (e) {
      console.warn("Mikrofon değiştirme hatası:", e);
    }
  },

  async switchAudioOutput(deviceId) {
    try {
      const audioElements = document.querySelectorAll('audio, video');
      for (const el of audioElements) {
        if (typeof el.setSinkId === 'function') {
          await el.setSinkId(deviceId);
        }
      }
      Notifications.show("Hoparlör çıkış cihazı değiştirildi.", "success", "Cihaz Değişimi");
    } catch (e) {
      console.warn("Hoparlör değiştirme hatası:", e);
    }
  }
};

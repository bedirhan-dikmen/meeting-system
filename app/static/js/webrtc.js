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

  async joinRoom(meetingCode, existingStream = null, isMicMuted = false, isCameraOff = false) {
    this.meetingCode = meetingCode;
    this.currentUser = Auth.getUser();
    this.isMicMuted = isMicMuted;
    this.isCameraOff = isCameraOff;

    // Fetch Meeting Details
    await this.fetchMeetingInfo();

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
      }
    } catch (e) {
      console.warn("Toplantı detayları alınamadı:", e);
    }
  },

  connectWebSocket() {
    const token = Auth.getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/signaling/ws/${this.meetingCode}?token=${token}`;

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log("WebSocket Sinyalleşme Sunucusuna Bağlandı.");
      this.updateConnectionBadge('online', 'Bağlı');
      
      // Odaya katıldığını bildiren broadcast
      this.sendSignal({
        type: 'user-joined',
        user_info: {
          id: this.currentUser?.id,
          name: `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Kullanıcı',
          department: 'Kurumsal'
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

  sendSignal(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  },

  async handleSignal(data) {
    const senderId = data.sender_id;

    switch (data.type) {
      case 'user-joined':
        Notifications.show(`${data.user_info?.name || 'Bir katılımcı'} odaya katıldı.`, 'info', 'Katılımcı');
        // Yeni katılan kullanıcı ile PeerConnection başlat (Offer gönder)
        if (senderId && senderId !== this.currentUser?.id) {
          await this.createPeerConnection(senderId, true);
        }
        break;

      case 'video-offer':
        if (senderId) {
          const pc = await this.createPeerConnection(senderId, false);
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
          await this.peers[senderId].setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
        break;

      case 'new-ice-candidate':
        if (senderId && this.peers[senderId] && data.candidate) {
          try {
            await this.peers[senderId].addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) {
            console.warn("ICE candidate ekleme hatası:", e);
          }
        }
        break;

      case 'user-left':
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

  async createPeerConnection(remoteUserId, isInitiator) {
    if (this.peers[remoteUserId]) return this.peers[remoteUserId];

    const pc = new RTCPeerConnection(this.iceServers);
    this.peers[remoteUserId] = pc;

    // Add local tracks to peer
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE Candidate event
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'new-ice-candidate',
          target_id: remoteUserId,
          candidate: event.candidate
        });
      }
    };

    // Remote Track event
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
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
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    let tile = document.getElementById('localVideoTile');
    if (!tile) {
      tile = document.createElement('div');
      tile.id = 'localVideoTile';
      tile.className = 'participant-tile';
      grid.appendChild(tile);
    }

    const initials = (this.currentUser?.first_name?.[0] || 'S') + (this.currentUser?.last_name?.[0] || 'EN');
    const name = `${this.currentUser?.first_name || ''} ${this.currentUser?.last_name || ''}`.trim() || 'Siz';

    tile.innerHTML = `
      <video id="localVideo" autoplay playsinline muted></video>
      <div id="localAvatar" class="avatar-placeholder" style="display: ${this.isCameraOff ? 'flex' : 'none'};">${initials}</div>
      <div class="tile-overlay">
        <span><strong>${name}</strong> (Siz)</span>
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <i id="localMicStatusIcon" class="fas ${this.isMicMuted ? 'fa-microphone-slash' : 'fa-microphone'}" style="color: ${this.isMicMuted ? 'var(--accent-rose)' : 'var(--accent-emerald)'}"></i>
        </div>
      </div>
    `;

    const videoEl = document.getElementById('localVideo');
    if (videoEl && this.localStream) {
      videoEl.srcObject = this.localStream;
      videoEl.style.display = this.isCameraOff ? 'none' : 'block';
    }
  },

  renderRemoteTile(remoteUserId, stream) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    let tile = document.getElementById(`remoteTile_${remoteUserId}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.id = `remoteTile_${remoteUserId}`;
      tile.className = 'participant-tile';
      grid.appendChild(tile);
    }

    tile.innerHTML = `
      <video id="remoteVideo_${remoteUserId}" autoplay playsinline></video>
      <div class="tile-overlay">
        <span>Katılımcı (${remoteUserId.slice(0, 5)})</span>
        ${this.isHost ? `
          <button onclick="WebRTC.kickParticipant('${remoteUserId}')" class="btn btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
            <i class="fas fa-user-minus"></i> Çıkar
          </button>
        ` : ''}
      </div>
    `;

    const videoEl = document.getElementById(`remoteVideo_${remoteUserId}`);
    if (videoEl) {
      videoEl.srcObject = stream;
    }
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
  },

  async toggleScreenShare() {
    if (!this.isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        this.screenTrack = screenStream.getVideoTracks()[0];
        
        // Replace video track in local stream and peer connections
        Object.values(this.peers).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(this.screenTrack);
        });

        const videoEl = document.getElementById('localVideo');
        if (videoEl) videoEl.srcObject = screenStream;

        this.isScreenSharing = true;
        document.getElementById('btnScreenShare')?.classList.add('active-off');

        this.screenTrack.onended = () => this.stopScreenShare();
      } catch (e) {
        console.warn("Ekran paylaşımı iptal edildi:", e);
      }
    } else {
      this.stopScreenShare();
    }
  },

  stopScreenShare() {
    if (this.screenTrack) {
      this.screenTrack.stop();
      this.screenTrack = null;
    }
    const cameraTrack = this.localStream.getVideoTracks()[0];
    Object.values(this.peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && cameraTrack) sender.replaceTrack(cameraTrack);
    });

    const videoEl = document.getElementById('localVideo');
    if (videoEl) videoEl.srcObject = this.localStream;

    this.isScreenSharing = false;
    document.getElementById('btnScreenShare')?.classList.remove('active-off');
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
    this.startTime = new Date();
    const timerEl = document.getElementById('roomTimer');

    this.timerInterval = setInterval(() => {
      const now = new Date();
      const diffSec = Math.floor((now - this.startTime) / 1000);
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
  }
};

/* ==========================================================================
   PRE-JOIN CAMERA & MICROPHONE PREVIEW MODULE
   ========================================================================== */

const Prejoin = {
  localStream: null,

  isMicMuted: sessionStorage.getItem('meeting_mic_muted') !== null ? (sessionStorage.getItem('meeting_mic_muted') === '1') : false,
  isCameraOff: sessionStorage.getItem('meeting_cam_off') !== null ? (sessionStorage.getItem('meeting_cam_off') === '1') : false,

  selectedCamId: sessionStorage.getItem('meeting_cam_id') || '',
  selectedMicId: sessionStorage.getItem('meeting_mic_id') || '',
  selectedSpeakerId: '',

  async init() {
    this.updateUserChip();
    this.bindControls();
    await this.startPreview();
  },

  updateUserChip() {
    try {
      const user = (typeof Auth !== 'undefined' && Auth.getCurrentUser) ? Auth.getCurrentUser() : null;
      if (user) {
        const first = user.first_name || '';
        const last = user.last_name || '';
        const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || 'YS';
        const fullName = `${first} ${last}`.trim() || 'Kullanıcı';

        const initEl = document.getElementById('prejoinInitialsChip');
        const nameEl = document.getElementById('prejoinUserNameChip');

        if (initEl) initEl.textContent = initials;
        if (nameEl) nameEl.textContent = fullName;
      }
    } catch (e) {
      console.warn("Kullanıcı profil çipi güncellenemedi:", e);
    }
  },

  async enumerateDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn("Tarayıcınız medya cihazlarını listelemeyi desteklemiyor.");
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoSelect = document.getElementById('cameraSelect');
      const audioSelect = document.getElementById('micSelect');
      const speakerSelect = document.getElementById('speakerSelect');

      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      const btnCam = document.getElementById('btnToggleCamPrejoin');
      if (btnCam) {
        if (videoDevices.length === 0) {
          btnCam.disabled = true;
          btnCam.innerHTML = '<i class="fas fa-video-slash"></i> Kamera Bulunamadı';
        } else {
          btnCam.disabled = false;
        }
      }

      const btnMic = document.getElementById('btnToggleMicPrejoin');
      if (btnMic) {
        if (audioInputs.length === 0) {
          btnMic.disabled = true;
          btnMic.innerHTML = '<i class="fas fa-microphone-slash"></i> Mikrofon Bulunamadı';
        } else {
          btnMic.disabled = false;
        }
      }

      if (videoSelect) {
        if (videoDevices.length > 0) {
          videoSelect.innerHTML = videoDevices.map((dev, i) => `
            <option value="${dev.deviceId}" ${dev.deviceId === this.selectedCamId ? 'selected' : ''}>${dev.label || 'Kamera ' + (i + 1)}</option>
          `).join('');
          if (!this.selectedCamId && videoDevices[0]) {
            this.selectedCamId = videoDevices[0].deviceId;
          }
        } else {
          videoSelect.innerHTML = '<option value="">Kamera Bulunamadı</option>';
        }
      }

      if (audioSelect) {
        if (audioInputs.length > 0) {
          audioSelect.innerHTML = audioInputs.map((dev, i) => `
            <option value="${dev.deviceId}" ${dev.deviceId === this.selectedMicId ? 'selected' : ''}>${dev.label || 'Mikrofon ' + (i + 1)}</option>
          `).join('');
          if (!this.selectedMicId && audioInputs[0]) {
            this.selectedMicId = audioInputs[0].deviceId;
          }
        } else {
          audioSelect.innerHTML = '<option value="">Mikrofon Bulunamadı</option>';
        }
      }

      if (speakerSelect) {
        if (audioOutputs.length > 0) {
          speakerSelect.innerHTML = audioOutputs.map((dev, i) => `
            <option value="${dev.deviceId}" ${dev.deviceId === this.selectedSpeakerId ? 'selected' : ''}>${dev.label || 'Hoparlör ' + (i + 1)}</option>
          `).join('');
          if (!this.selectedSpeakerId && audioOutputs[0]) {
            this.selectedSpeakerId = audioOutputs[0].deviceId;
          }
        } else {
          speakerSelect.innerHTML = '<option value="">Hoparlör Bulunamadı</option>';
        }
      }
    } catch (err) {
      console.warn("Cihaz listeleme hatası:", err);
    }
  },

  async startPreview() {
    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
      }

      const videoConstraints = this.selectedCamId ? { deviceId: { exact: this.selectedCamId } } : true;
      const audioConstraints = this.selectedMicId ? { deviceId: { exact: this.selectedMicId } } : true;

      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioConstraints
      });

      this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);

      await this.enumerateDevices();
      this.updateCamUI();
      this.updateMicUI();

    } catch (err) {
      console.warn("Spesifik kamera/mikrofon akışı alınamadı, varsayılan deneniyor:", err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
        this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);
        await this.enumerateDevices();
        this.updateCamUI();
        this.updateMicUI();
      } catch (err2) {
        console.warn("Medya izni verilemedi veya cihaz yok:", err2);
        await this.enumerateDevices();
        this.updateCamUI();
        this.updateMicUI();
      }
    }
  },

  updateCamUI() {
    const videoElement = document.getElementById('prejoinVideo');
    const avatarPlaceholder = document.getElementById('prejoinAvatar');
    const btnCam = document.getElementById('btnToggleCamPrejoin');

    if (videoElement) {
      if (this.localStream && this.localStream.getVideoTracks().length > 0) {
        videoElement.srcObject = this.localStream;
      }
      videoElement.style.display = this.isCameraOff ? 'none' : 'block';
    }

    if (avatarPlaceholder) {
      avatarPlaceholder.style.display = this.isCameraOff ? 'flex' : 'none';
    }

    if (btnCam && !btnCam.disabled) {
      if (this.isCameraOff) {
        btnCam.innerHTML = '<i class="fas fa-video-slash"></i> Kamerayı Aç';
        btnCam.style.background = '#f1f5f9';
        btnCam.style.color = '#475569';
        btnCam.style.border = '1px solid #cbd5e1';
      } else {
        btnCam.innerHTML = '<i class="fas fa-video"></i> Kamerayı Kapat';
        btnCam.style.background = '#5b5fc7';
        btnCam.style.color = '#ffffff';
        btnCam.style.border = 'none';
      }
    }
  },

  updateMicUI() {
    const btnMic = document.getElementById('btnToggleMicPrejoin');
    if (btnMic && !btnMic.disabled) {
      if (this.isMicMuted) {
        btnMic.innerHTML = '<i class="fas fa-microphone-slash"></i> Mikrofonu Aç';
        btnMic.style.background = '#f1f5f9';
        btnMic.style.color = '#475569';
        btnMic.style.border = '1px solid #cbd5e1';
      } else {
        btnMic.innerHTML = '<i class="fas fa-microphone"></i> Mikrofonu Kapat';
        btnMic.style.background = '#5b5fc7';
        btnMic.style.color = '#ffffff';
        btnMic.style.border = 'none';
      }
    }
  },

  async toggleMic() {
    this.isMicMuted = !this.isMicMuted;
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks.forEach(t => t.enabled = !this.isMicMuted);
      } else if (!this.isMicMuted) {
        await this.startPreview();
        return;
      }
    } else if (!this.isMicMuted) {
      await this.startPreview();
      return;
    }

    this.updateMicUI();
    this.savePrejoinState();
  },

  async toggleCamera() {
    this.isCameraOff = !this.isCameraOff;
    if (this.localStream) {
      const videoTracks = this.localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks.forEach(t => t.enabled = !this.isCameraOff);
      } else if (!this.isCameraOff) {
        await this.startPreview();
        return;
      }
    } else if (!this.isCameraOff) {
      await this.startPreview();
      return;
    }

    this.updateCamUI();
    this.savePrejoinState();
  },

  bindControls() {
    const btnCam = document.getElementById('btnToggleCamPrejoin');
    const btnMic = document.getElementById('btnToggleMicPrejoin');
    const videoSelect = document.getElementById('cameraSelect');
    const audioSelect = document.getElementById('micSelect');
    const speakerSelect = document.getElementById('speakerSelect');

    if (btnCam) btnCam.addEventListener('click', () => this.toggleCamera());
    if (btnMic) btnMic.addEventListener('click', () => this.toggleMic());

    if (videoSelect) {
      videoSelect.addEventListener('change', async () => {
        this.selectedCamId = videoSelect.value;
        this.savePrejoinState();
        await this.startPreview();
      });
    }

    if (audioSelect) {
      audioSelect.addEventListener('change', async () => {
        this.selectedMicId = audioSelect.value;
        this.savePrejoinState();
        await this.startPreview();
      });
    }

    if (speakerSelect) {
      speakerSelect.addEventListener('change', () => {
        this.selectedSpeakerId = speakerSelect.value;
        this.savePrejoinState();
      });
    }
  },

  meetingCode: '',
  meetingInfo: null,
  lobbySocket: null,

  async fetchMeetingInfo(meetingCode) {
    this.meetingCode = meetingCode;
    try {
      const res = await fetch(`/api/v1/meetings/code/${meetingCode}`, {
        headers: (typeof Auth !== 'undefined' && Auth.getAuthHeaders) ? Auth.getAuthHeaders() : {}
      });
      if (res.ok) {
        this.meetingInfo = await res.json();
      }
    } catch (e) {
      console.warn("Toplantı detayları alınamadı:", e);
    }
  },

  async proceedToRoom(meetingCode) {
    this.savePrejoinState();
    if (!this.meetingInfo) {
      await this.fetchMeetingInfo(meetingCode);
    }
    const user = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
    const isAdmin = Boolean(user && (user.role === 'admin' || user.is_superuser));
    const isHost = Boolean(this.meetingInfo && user && (
      String(this.meetingInfo.created_by).toLowerCase() === String(user.id || user.user_id || '').toLowerCase()
    ));

    console.log("[Prejoin] Proceed check. User:", user?.email, "IsAdmin:", isAdmin, "IsHost:", isHost);

    // Yalnızca sistem yöneticisi (admin/superuser) veya toplantıyı oluşturan Oda Yöneticisi (Host) direkt odaya geçer
    if (isAdmin || isHost) {
      this.cleanup();
      window.location.href = `/room/${meetingCode}`;
      return;
    }

    // Şirket içi tüm katılımcılar ve davetliler Kamera Testi sonrası Bekleme Odası'na (Lobi) alınır
    const setupEl = document.getElementById('prejoinSetupContainer');
    const lobbyEl = document.getElementById('waitingLobbyContainer');
    if (setupEl) setupEl.style.display = 'none';
    if (lobbyEl) lobbyEl.style.display = 'flex';

    this.connectLobbyWS(meetingCode);
  },

  connectLobbyWS(meetingCode) {
    const token = (typeof Auth !== 'undefined' && Auth.getToken) ? Auth.getToken() : '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/signaling/ws/${meetingCode}?token=${token}`;

    try {
      if (this.lobbySocket) {
        this.lobbySocket.close();
      }

      this.lobbySocket = new WebSocket(wsUrl);

      this.lobbySocket.onopen = () => {
        const user = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
        const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email : 'Katılımcı';
        const userId = user ? (user.id || user.user_id) : '';
        this.lobbySocket.send(JSON.stringify({
          type: 'lobby-join-request',
          user_info: {
            id: userId,
            name: fullName,
            email: user?.email,
            role: user?.role || 'participant',
            avatar_url: user?.avatar_url,
            in_lobby: true
          }
        }));
      };

      this.lobbySocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'lobby-approved') {
            sessionStorage.setItem('meeting_lobby_approved_' + meetingCode, '1');
            if (typeof Notifications !== 'undefined') {
              Notifications.show("Toplantı katılım talebiniz onaylandı! Odaya aktarılıyorsunuz...", "success", "Katılım Onaylandı");
            }
            setTimeout(() => {
              this.cleanup();
              window.location.href = `/room/${meetingCode}`;
            }, 800);
          } else if (data.type === 'lobby-rejected' || data.type === 'kicked') {
            if (typeof Notifications !== 'undefined') {
              Notifications.show("Katılım talebiniz toplantı yöneticisi tarafından reddedildi.", "warning", "Katılım Reddedildi");
            }
            setTimeout(() => {
              this.cleanup();
              window.location.href = '/meetings';
            }, 1500);
          }
        } catch (e) {
          console.warn("Lobi sinyali okuma hatası:", e);
        }
      };

      this.lobbySocket.onerror = (err) => {
        console.warn("Lobi soket hatası:", err);
      };
    } catch (e) {
      console.warn("Lobi bağlantısı kurulamadı:", e);
    }
  },

  savePrejoinState() {
    sessionStorage.setItem('meeting_cam_off', this.isCameraOff ? '1' : '0');
    sessionStorage.setItem('meeting_mic_muted', this.isMicMuted ? '1' : '0');
    if (this.selectedCamId) sessionStorage.setItem('meeting_cam_id', this.selectedCamId);
    if (this.selectedMicId) sessionStorage.setItem('meeting_mic_id', this.selectedMicId);
  },

  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.lobbySocket) {
      try { this.lobbySocket.close(); } catch (e) {}
      this.lobbySocket = null;
    }
  }
};

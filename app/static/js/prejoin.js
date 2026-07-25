/* ==========================================================================
   PRE-JOIN CAMERA & MICROPHONE PREVIEW MODULE
   ========================================================================== */

const Prejoin = {
  localStream: null,
  audioContext: null,
  analyser: null,
  animFrameId: null,

  isMicMuted: true, // Default OFF
  isCameraOff: true, // Default OFF

  selectedCamId: '',
  selectedMicId: '',
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

      if (videoSelect) videoSelect.innerHTML = '<option value="">Kamera Yok / Kapalı</option>';
      if (audioSelect) audioSelect.innerHTML = '<option value="">Mikrofon Yok / Kapalı</option>';
      if (speakerSelect) speakerSelect.innerHTML = '<option value="">Hoparlör Seçin</option>';

      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const audioOutputs = devices.filter(d => d.kind === 'audiooutput');

      if (videoDevices.length > 0 && videoSelect) {
        videoSelect.innerHTML = videoDevices.map((dev, i) => `
          <option value="${dev.deviceId}">${dev.label || 'Kamera ' + (i + 1)}</option>
        `).join('');
      } else {
        const btnCam = document.getElementById('btnToggleCamPrejoin');
        if (btnCam) {
          btnCam.disabled = true;
          btnCam.innerHTML = '<i class="fas fa-video-slash"></i> Kamera Algılanamadı';
        }
      }

      if (audioInputs.length > 0 && audioSelect) {
        audioSelect.innerHTML = audioInputs.map((dev, i) => `
          <option value="${dev.deviceId}">${dev.label || 'Mikrofon ' + (i + 1)}</option>
        `).join('');
      }

      if (audioOutputs.length > 0 && speakerSelect) {
        speakerSelect.innerHTML = audioOutputs.map((dev, i) => `
          <option value="${dev.deviceId}">${dev.label || 'Hoparlör ' + (i + 1)}</option>
        `).join('');
      }
    } catch (err) {
      console.warn("Cihaz listeleme hatası:", err);
    }
  },

  async startPreview() {
    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
      }

      // Pre-request permissions with standard constraints
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      // Default OFF state for tracks
      this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);

      await this.enumerateDevices();

      const videoElement = document.getElementById('prejoinVideo');
      const avatarPlaceholder = document.getElementById('prejoinAvatar');

      if (videoElement) {
        videoElement.srcObject = this.localStream;
        videoElement.style.display = this.isCameraOff ? 'none' : 'block';
      }

      if (avatarPlaceholder) {
        avatarPlaceholder.style.display = this.isCameraOff ? 'flex' : 'none';
      }

      const btnCam = document.getElementById('btnToggleCamPrejoin');
      if (btnCam) {
        btnCam.innerHTML = this.isCameraOff ? '<i class="fas fa-video-slash"></i> Kamerayı Aç' : '<i class="fas fa-video"></i> Kamerayı Kapat';
      }

    } catch (err) {
      console.warn("Medya cihazı başlatılamadı veya izin verilmedi:", err);
      const videoElement = document.getElementById('prejoinVideo');
      const avatarPlaceholder = document.getElementById('prejoinAvatar');
      if (videoElement) videoElement.style.display = 'none';
      if (avatarPlaceholder) avatarPlaceholder.style.display = 'flex';
      await this.enumerateDevices();
    }
  },

  toggleMic() {
    this.isMicMuted = !this.isMicMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);
    }
  },

  toggleCamera() {
    this.isCameraOff = !this.isCameraOff;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(t => t.enabled = !this.isCameraOff);
    }

    const videoElement = document.getElementById('prejoinVideo');
    const avatarPlaceholder = document.getElementById('prejoinAvatar');

    if (videoElement) videoElement.style.display = this.isCameraOff ? 'none' : 'block';
    if (avatarPlaceholder) avatarPlaceholder.style.display = this.isCameraOff ? 'flex' : 'none';

    const btn = document.getElementById('btnToggleCamPrejoin');
    if (btn) {
      btn.innerHTML = this.isCameraOff ? '<i class="fas fa-video-slash"></i> Kamerayı Aç' : '<i class="fas fa-video"></i> Kamerayı Kapat';
    }
  },

  bindControls() {
    const btnCam = document.getElementById('btnToggleCamPrejoin');
    const videoSelect = document.getElementById('cameraSelect');
    const audioSelect = document.getElementById('micSelect');
    const speakerSelect = document.getElementById('speakerSelect');

    if (btnCam) btnCam.addEventListener('click', () => this.toggleCamera());

    if (videoSelect) {
      videoSelect.addEventListener('change', () => {
        this.selectedCamId = videoSelect.value;
      });
    }

    if (audioSelect) {
      audioSelect.addEventListener('change', () => {
        this.selectedMicId = audioSelect.value;
      });
    }

    if (speakerSelect) {
      speakerSelect.addEventListener('change', () => {
        this.selectedSpeakerId = speakerSelect.value;
      });
    }
  },

  savePrejoinState() {
    sessionStorage.setItem('meeting_cam_off', this.isCameraOff ? '1' : '0');
    sessionStorage.setItem('meeting_mic_muted', this.isMicMuted ? '1' : '0');
    if (this.selectedCamId) sessionStorage.setItem('meeting_cam_id', this.selectedCamId);
    if (this.selectedMicId) sessionStorage.setItem('meeting_mic_id', this.selectedMicId);
  }
};


/* ==========================================================================
   PRE-JOIN CAMERA & MICROPHONE PREVIEW MODULE
   ========================================================================== */

const Prejoin = {
  localStream: null,
  audioContext: null,
  analyser: null,
  animFrameId: null,

  isMicMuted: false,
  isCameraOff: false,

  selectedCamId: '',
  selectedMicId: '',

  async init() {
    await this.enumerateDevices();
    await this.startPreview();
    this.bindControls();
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

      if (videoSelect) videoSelect.innerHTML = '';
      if (audioSelect) audioSelect.innerHTML = '';

      devices.forEach(dev => {
        const option = document.createElement('option');
        option.value = dev.deviceId;
        option.text = dev.label || `${dev.kind} (${dev.deviceId.slice(0, 5)}...)`;

        if (dev.kind === 'videoinput' && videoSelect) {
          videoSelect.appendChild(option);
        } else if (dev.kind === 'audioinput' && audioSelect) {
          audioSelect.appendChild(option);
        }
      });

      if (videoSelect) {
        videoSelect.addEventListener('change', () => {
          this.selectedCamId = videoSelect.value;
          this.startPreview();
        });
      }

      if (audioSelect) {
        audioSelect.addEventListener('change', () => {
          this.selectedMicId = audioSelect.value;
          this.startPreview();
        });
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

      const constraints = {
        video: this.selectedCamId ? { deviceId: { exact: this.selectedCamId } } : true,
        audio: this.selectedMicId ? { deviceId: { exact: this.selectedMicId } } : true
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);

      const videoElement = document.getElementById('prejoinVideo');
      const avatarPlaceholder = document.getElementById('prejoinAvatar');

      if (videoElement) {
        videoElement.srcObject = this.localStream;
        videoElement.style.display = this.isCameraOff ? 'none' : 'block';
      }

      if (avatarPlaceholder) {
        avatarPlaceholder.style.display = this.isCameraOff ? 'flex' : 'none';
      }

      this.setupAudioMeter(this.localStream);
    } catch (err) {
      console.error("Kamera/Mikrofon erişim hatası:", err);
      Notifications.show("Kamera veya mikrofona erişilemedi. Lütfen tarayıcı izinlerini kontrol edin.", "warning", "Medya İzni");
    }
  },

  setupAudioMeter(stream) {
    try {
      if (this.audioContext) this.audioContext.close();
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      mediaStreamSource.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const fillBar = document.getElementById('micMeterFill');

      const updateMeter = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const volumePercent = Math.min(100, Math.round((average / 128) * 100));

        if (fillBar) {
          fillBar.style.width = this.isMicMuted ? '0%' : `${volumePercent}%`;
        }

        this.animFrameId = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (e) {
      console.warn("Ses göstergesi başlatılamadı:", e);
    }
  },

  toggleMic() {
    this.isMicMuted = !this.isMicMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMicMuted);
    }

    const btn = document.getElementById('btnToggleMicPrejoin');
    if (btn) {
      btn.classList.toggle('active-off', this.isMicMuted);
      btn.innerHTML = this.isMicMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
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
      btn.classList.toggle('active-off', this.isCameraOff);
      btn.innerHTML = this.isCameraOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
    }
  },

  bindControls() {
    const btnMic = document.getElementById('btnToggleMicPrejoin');
    const btnCam = document.getElementById('btnToggleCamPrejoin');

    if (btnMic) btnMic.addEventListener('click', () => this.toggleMic());
    if (btnCam) btnCam.addEventListener('click', () => this.toggleCamera());
  },

  stopPreview() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.audioContext) this.audioContext.close();
    if (this.localStream) {
      // Don't stop tracks so they can be transferred to meeting room, or keep reference
    }
  }
};

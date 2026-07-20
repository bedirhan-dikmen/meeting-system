// ============================================
// PREVIEW.JS - LOBİ CİHAZ KONTROL VE ÖNİZLEME
// ============================================

const API_BASE = 'http://localhost:8000/api/v1';
const token = localStorage.getItem('token');

if (!token) window.location.href = '/';

let previewStream = null;
let meetingCode = null;
let audioEnabled = true;
let videoEnabled = true;

const DOM = {
    video: document.getElementById('previewVideo'),
    camOverlay: document.getElementById('camOffOverlay'),
    meetingTitle: document.getElementById('meetingTitle'),
    micSelect: document.getElementById('micSelect'),
    cameraSelect: document.getElementById('cameraSelect')
};

async function initPreview() {
    const pathSegments = window.location.pathname.split('/');
    meetingCode = pathSegments.pop();

    if (!meetingCode || meetingCode === 'preview') {
        window.location.href = '/dashboard';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/meetings/code/${meetingCode}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            if (DOM.meetingTitle) DOM.meetingTitle.textContent = data.title || 'Toplantı Lobisi';
        }
    } catch (e) {}

    await startPreviewStream();
    await loadDevices();
}

async function startPreviewStream(audioId = null, videoId = null) {
    try {
        if (previewStream) {
            previewStream.getTracks().forEach(t => t.stop());
        }

        const constraints = {
            audio: audioId ? { deviceId: { exact: audioId } } : true,
            video: videoId ? { deviceId: { exact: videoId } } : { width: { ideal: 1280 }, height: { ideal: 720 } }
        };

        previewStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (DOM.video) DOM.video.srcObject = previewStream;
    } catch (err) {
        console.error('Medya önizleme hatası:', err);
        if (DOM.camOverlay) DOM.camOverlay.style.display = 'flex';
    }
}

async function loadDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (DOM.micSelect) DOM.micSelect.innerHTML = '';
        if (DOM.cameraSelect) DOM.cameraSelect.innerHTML = '';

        let micC = 1, camC = 1;
        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            if (d.kind === 'audioinput' && DOM.micSelect) {
                opt.text = d.label || `Mikrofon ${micC++}`;
                DOM.micSelect.appendChild(opt);
            } else if (d.kind === 'videoinput' && DOM.cameraSelect) {
                opt.text = d.label || `Kamera ${camC++}`;
                DOM.cameraSelect.appendChild(opt);
            }
        });
    } catch (e) {}
}

async function changeCamera(deviceId) {
    await startPreviewStream(DOM.micSelect ? DOM.micSelect.value : null, deviceId);
}

async function changeMic(deviceId) {
    await startPreviewStream(deviceId, DOM.cameraSelect ? DOM.cameraSelect.value : null);
}

function toggleAudioPref() {
    audioEnabled = document.getElementById('joinWithAudio').checked;
    if (previewStream) {
        previewStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    }
}

function toggleVideoPref() {
    videoEnabled = document.getElementById('joinWithVideo').checked;
    if (previewStream) {
        previewStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
    }
    if (DOM.camOverlay) {
        DOM.camOverlay.style.display = videoEnabled ? 'none' : 'flex';
    }
}

function joinRoom() {
    // Tercihleri sessionStorage üzerinden odaya aktarabiliriz
    sessionStorage.setItem('pref_audio', audioEnabled);
    sessionStorage.setItem('pref_video', videoEnabled);
    
    // Canlı odaya yönlendir
    window.location.href = `/room/${meetingCode}`;
}

document.addEventListener('DOMContentLoaded', initPreview);
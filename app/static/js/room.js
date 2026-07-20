// ============================================
// ROOM.JS - TAM İŞLEVLİ WEBRTC & ODA YÖNETİMİ
// ============================================

const API_BASE = 'http://localhost:8000/api/v1';
const token = localStorage.getItem('token');
let localStream = null;
let meetingTimer = null;
let activeSeconds = 0;
let meetingCode = null;
let ws = null;
let peerConnection = null;

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

if (!token) window.location.href = '/';

const DOM = {
    roomTitle: document.getElementById('roomTitle'),
    roomCode: document.getElementById('roomCode'),
    localVideo: document.getElementById('localVideo'),
    userLabel: document.getElementById('userLabel'),
    audioBtn: document.getElementById('audioBtn'),
    videoBtn: document.getElementById('videoBtn'),
    screenBtn: document.getElementById('screenBtn'),
    timerBadge: document.getElementById('meetingTimer'),
    noteInput: document.getElementById('noteInput'),
    notesList: document.getElementById('notesList'),
    sidePanel: document.getElementById('sidePanel'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    taskTitle: document.getElementById('taskTitle'),
    taskAssignee: document.getElementById('taskAssignee'),
    tasksList: document.getElementById('tasksList')
};

// 1. ODA BİLGİSİ VE MEDYA BAŞLATMA
async function initRoom() {
    const path = window.location.pathname;
    meetingCode = path.split('/').pop();

    if (!meetingCode || meetingCode === 'room') {
        window.location.href = '/dashboard';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/meetings/code/${meetingCode}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Oda bulunamadı');
        const data = await res.json();
        
        DOM.roomTitle.textContent = data.title;
        DOM.roomCode.textContent = `Kod: ${data.meeting_code}`;

        await logParticipantEvent('JOIN');
        await startLocalMedia();
        startTimer();

        const userId = parseJwt(token).sub || 'user_' + Math.floor(Math.random() * 1000);
        setupSocketAndRTC(meetingCode, userId);

    } catch (err) {
        alert('Odaya bağlanırken hata oluştu: ' + err.message);
        window.location.href = '/dashboard';
    }
}

// 2. GERÇEK KAMERA VE MİKROFON ERİŞİMİ
async function startLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: true
        });
        if (DOM.localVideo) {
            DOM.localVideo.style.objectFit = 'contain';
            DOM.localVideo.srcObject = localStream;
        }
    } catch (err) {
        console.error('Medya aygıtlarına erişilemedi:', err);
        showToast('Kamera veya mikrofon erişimi engellendi.', 'warning');
    }
}

// 3. MİKROFON AÇ / KAPAT
function toggleAudio() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        DOM.audioBtn.className = audioTrack.enabled ? 'btn btn-primary' : 'btn btn-danger';
        DOM.audioBtn.innerHTML = audioTrack.enabled ? '🎤 Ses Açık' : '🔇 Sessiz';
    }
}

// 4. KAMERA AÇ / KAPAT
function toggleVideo() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        DOM.videoBtn.className = videoTrack.enabled ? 'btn btn-primary' : 'btn btn-danger';
        DOM.videoBtn.innerHTML = videoTrack.enabled ? '📹 Kamera Açık' : '📷 Kapalı';
    }
}

// 5. 16:9 FULL EKRAN PAYLAŞIMI (KIRPMASIZ FIX)
async function toggleScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                displaySurface: "monitor",
                width: { ideal: 1920, max: 3840 },
                height: { ideal: 1080, max: 2160 },
                frameRate: { max: 30 }
            },
            audio: true
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        if (DOM.localVideo) {
            DOM.localVideo.style.objectFit = 'contain'; // Kırpmayı sıfırlar
            DOM.localVideo.srcObject = screenStream;
            DOM.userLabel.textContent = 'Siz (Ekran Paylaşımı)';
        }

        if (peerConnection) {
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) videoSender.replaceTrack(screenTrack);
        }

        screenTrack.onended = () => stopScreenSharing();
        showToast('🖥️ Ekran paylaşımı başlatıldı.', 'success');

    } catch (err) {
        console.error('Ekran paylaşımı başlatılamadı:', err);
    }
}

function stopScreenSharing() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (DOM.localVideo) {
            DOM.localVideo.srcObject = localStream;
            DOM.userLabel.textContent = 'Siz';
        }

        if (peerConnection) {
            const senders = peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) videoSender.replaceTrack(videoTrack);
        }
    }
    showToast('🖥️ Ekran paylaşımı kapatıldı.', 'info');
}

// 6. WEBSOCKET VE WEBRTC YÖNETİMİ
function setupSocketAndRTC(meetingCode, userId) {
    ws = new WebSocket(`ws://localhost:8000/api/v1/ws/meeting/${meetingCode}/${userId}`);

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        switch (data.event) {
            case 'USER_JOINED':
                showToast(`👤 ${data.user_id || 'Bir katılımcı'} odaya girdi.`, 'info');
                createOffer();
                break;
            case 'USER_LEFT':
                showToast(`🚪 Katılımcı odadan ayrıldı.`, 'warning');
                break;
            case 'CHAT_MESSAGE':
                renderChatMessage(data.sender, data.message);
                break;
            case 'NEW_TASK':
                renderTaskItem(data.task);
                showToast(`✅ Yeni Görev: ${data.task.title}`, 'success');
                break;
            default:
                if (data.sdp) await handleSDP(data.sdp);
                else if (data.candidate && peerConnection) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
        }
    };
}

// 7. CANLI SOHBET (CHAT)
function sendChatMessage() {
    const text = DOM.chatInput.value.trim();
    if (!text || !ws) return;

    ws.send(JSON.stringify({ event: 'CHAT_MESSAGE', message: text, sender: 'Siz' }));
    renderChatMessage('Siz', text, true);
    DOM.chatInput.value = '';
}

function renderChatMessage(sender, text, isMe = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${isMe ? 'chat-msg-me' : 'chat-msg-other'} text-white shadow-sm`;
    msgDiv.innerHTML = `<small class="d-block fw-bold opacity-75">${sender}</small><span>${escapeHtml(text)}</span>`;
    DOM.chatMessages.appendChild(msgDiv);
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

// 8. CANLI NOT EKLEME
async function addMeetingNote() {
    const text = DOM.noteInput.value.trim();
    if (!text) return;

    try {
        const res = await fetch(`${API_BASE}/reports/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ meeting_code: meetingCode, content: text })
        });

        if (res.ok) {
            const li = document.createElement('li');
            li.className = 'list-group-item bg-dark text-white border-secondary rounded mb-1';
            li.textContent = text;
            DOM.notesList.prepend(li);
            DOM.noteInput.value = '';
            showToast('📝 Not kaydedildi.', 'success');
        }
    } catch (err) {
        console.error('Not kaydedilemedi:', err);
    }
}

// 9. CANLI GÖREV/İŞ ATAMA (ACTION ITEMS)
async function assignTask() {
    const title = DOM.taskTitle.value.trim();
    const assignee = DOM.taskAssignee.value.trim();

    if (!title || !assignee) {
        showToast('⚠️ Lütfen görev başlığı ve e-posta yazın.', 'warning');
        return;
    }

    const taskPayload = { meeting_code: meetingCode, title: title, assigned_to: assignee, status: 'PENDING' };

    try {
        const res = await fetch(`${API_BASE}/tasks/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(taskPayload)
        });

        if (res.ok) {
            const createdTask = await res.json();
            renderTaskItem(createdTask);

            if (ws) ws.send(JSON.stringify({ event: 'NEW_TASK', task: createdTask }));

            DOM.taskTitle.value = '';
            DOM.taskAssignee.value = '';
            showToast('✅ Görev başarıyla atandı.', 'success');
        }
    } catch (err) {
        console.error('Görev atama hatası:', err);
    }
}

function renderTaskItem(task) {
    const item = document.createElement('div');
    item.className = 'p-2 bg-dark border border-warning rounded text-white small shadow-sm';
    item.innerHTML = `
        <div class="fw-bold text-warning">📌 ${escapeHtml(task.title)}</div>
        <div class="text-muted">Atanan: ${escapeHtml(task.assigned_to)}</div>
        <span class="badge bg-secondary mt-1">${task.status || 'PENDING'}</span>
    `;
    DOM.tasksList.prepend(item);
}

// UI YARDIMCILARI
function toggleSidePanel(tabName = 'chat') {
    if (DOM.sidePanel.classList.contains('d-none')) {
        DOM.sidePanel.classList.remove('d-none');
        DOM.sidePanel.classList.add('d-flex');
    } else if (tabName === getCurrentTab()) {
        DOM.sidePanel.classList.add('d-none');
        DOM.sidePanel.classList.remove('d-flex');
    }
    if (tabName) switchTab(tabName);
}

function switchTab(tab) {
    document.getElementById('tabChat').classList.add('d-none');
    document.getElementById('tabNotes').classList.add('d-none');
    document.getElementById('tabTasks').classList.add('d-none');

    document.getElementById('tabBtnChat').classList.remove('active');
    document.getElementById('tabBtnNotes').classList.remove('active');
    document.getElementById('tabBtnTasks').classList.remove('active');

    if (tab === 'chat') {
        document.getElementById('tabChat').classList.remove('d-none');
        document.getElementById('tabBtnChat').classList.add('active');
    } else if (tab === 'notes') {
        document.getElementById('tabNotes').classList.remove('d-none');
        document.getElementById('tabBtnNotes').classList.add('active');
    } else if (tab === 'tasks') {
        document.getElementById('tabTasks').classList.remove('d-none');
        document.getElementById('tabBtnTasks').classList.add('active');
    }
}

function getCurrentTab() {
    if (!document.getElementById('tabChat').classList.contains('d-none')) return 'chat';
    if (!document.getElementById('tabNotes').classList.contains('d-none')) return 'notes';
    if (!document.getElementById('tabTasks').classList.contains('d-none')) return 'tasks';
    return null;
}

function startTimer() {
    meetingTimer = setInterval(() => {
        activeSeconds++;
        const mins = String(Math.floor(activeSeconds / 60)).padStart(2, '0');
        const secs = String(activeSeconds % 60).padStart(2, '0');
        if (DOM.timerBadge) DOM.timerBadge.textContent = `${mins}:${secs}`;
    }, 1000);
}

function parseJwt(token) {
    try { return JSON.parse(atob(token.split('.')[1])); } catch (e) { return {}; }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(msg, type = 'info') {
    const toastEl = document.getElementById('liveToast');
    const colors = { success: 'bg-success', warning: 'bg-warning text-dark', info: 'bg-primary' };
    toastEl.className = `toast text-white border-0 ${colors[type] || 'bg-primary'}`;
    document.getElementById('toastMessage').textContent = msg;
    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}

async function logParticipantEvent(eventType) {
    try {
        await fetch(`${API_BASE}/meetings/log-event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ meeting_code: meetingCode, event_type: eventType, timestamp: new Date().toISOString() })
        });
    } catch (e) { console.error('Log kaydı hatası', e); }
}

async function leaveRoom() {
    if (confirm('Toplantıdan ayrılmak istiyor musunuz?')) {
        clearInterval(meetingTimer);
        await logParticipantEvent('LEAVE');
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        window.location.href = '/dashboard';
    }
}

document.addEventListener('DOMContentLoaded', initRoom);
window.onbeforeunload = () => { logParticipantEvent('LEAVE'); };
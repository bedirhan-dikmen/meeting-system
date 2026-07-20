// ============================================
// ROOM.JS - TAM İŞLEVLİ & KUSURSUZ CANLI ODA LOGİC
// ============================================

const API_BASE = 'http://localhost:8000/api/v1';
const token = localStorage.getItem('token');

let localStream = null;
let currentRoom = null; // LiveKit Room Nesnesi
let meetingTimer = null;
let activeSeconds = 0;
let meetingCode = null;
let currentMeetingId = null;
let ws = null;
let isAudioMuted = false;
let isVideoMuted = false;

let currentUserInfo = { id: '', name: 'Katılımcı', email: '' };
let allUsersList = [];

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
    taskDescription: document.getElementById('taskDescription'),
    taskAssigneeSelect: document.getElementById('taskAssigneeSelect'),
    tasksList: document.getElementById('tasksList'),
    usersTableBody: document.getElementById('usersTableBody'),
    micSelect: document.getElementById('micSelect'),
    cameraSelect: document.getElementById('cameraSelect'),
    speakerSelect: document.getElementById('speakerSelect')
};

// 1. KULLANICI BİLGİLERİNİ (AD SOYAD) GERÇEK API'DEN ÇEKME FIX
async function fetchCurrentUserInfo() {
    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            currentUserInfo.id = user.id;
            currentUserInfo.email = user.email || '';
            const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
            currentUserInfo.name = fullName || user.email || 'Katılımcı';
        } else {
            parseJwtFallback();
        }
    } catch (e) {
        parseJwtFallback();
    }
}

function parseJwtFallback() {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUserInfo.id = payload.sub || payload.user_id || '';
        currentUserInfo.email = payload.email || '';
        const fn = payload.first_name || '';
        const ln = payload.last_name || '';
        if (fn || ln) currentUserInfo.name = `${fn} ${ln}`.trim();
        else if (currentUserInfo.email) currentUserInfo.name = currentUserInfo.email.split('@')[0];
    } catch (e) {}
}

// 2. CANLI ODA İNİTİALİZASYONU
async function initRoom() {
    await fetchCurrentUserInfo();

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

        if (!res.ok) throw new Error('Toplantı odası bilgisi çekilemedi.');
        const data = await res.json();

        currentMeetingId = data.id;
        if (DOM.roomTitle) DOM.roomTitle.textContent = data.title || 'Toplantı Odası';
        if (DOM.roomCode) DOM.roomCode.textContent = `Kod: ${data.meeting_code}`;

        await startLocalMedia();
        startTimer();
        await loadSystemUsers();

        setupSocket(meetingCode);
        connectToLiveKit(meetingCode);

    } catch (err) {
        console.error('Oda başlatma hatası:', err);
        showToast('Odaya bağlanırken hata oluştu: ' + err.message, 'warning');
    }
}

// 3. MEDYA VE KAMERA / MİKROFON KONTROLÜ (SES & VİDEO TOGGLE FIX)
async function startLocalMedia(audioDeviceId = null, videoDeviceId = null) {
    try {
        const constraints = {
            audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
            video: videoDeviceId ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }
        };

        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        if (DOM.localVideo) {
            DOM.localVideo.srcObject = localStream;
            DOM.localVideo.style.objectFit = 'contain';
        }
        if (DOM.userLabel) DOM.userLabel.textContent = `${currentUserInfo.name} (Siz)`;

    } catch (err) {
        console.error('Kamera/Mikrofon erişilemedi:', err);
        showToast('⚠️ Kamera/Mikrofon erişimi sağlayan aygıt bulunamadı.', 'warning');
    }
}

// MİKROFON AÇ / KAPAT FIX
async function toggleAudio() {
    isAudioMuted = !isAudioMuted;

    // 1. LiveKit Katılımcı Sesi
    if (currentRoom && currentRoom.localParticipant) {
        try {
            await currentRoom.localParticipant.setMicrophoneEnabled(!isAudioMuted);
        } catch (e) { console.error('LiveKit ses değiştirilemedi', e); }
    }

    // 2. Yerel Akış Track Sesi
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isAudioMuted;
        });
    }

    if (DOM.audioBtn) {
        DOM.audioBtn.className = !isAudioMuted ? 'btn btn-primary px-3 fw-semibold' : 'btn btn-danger px-3 fw-semibold';
        DOM.audioBtn.innerHTML = !isAudioMuted ? '🎤 Ses Açık' : '🔇 Sessiz';
    }
    showToast(!isAudioMuted ? '🎤 Mikrofon açıldı.' : '🔇 Mikrofon kapatıldı.', 'info');
}

// KAMERA AÇ / KAPAT FIX
async function toggleVideo() {
    isVideoMuted = !isVideoMuted;

    // 1. LiveKit Katılımcı Kamerası
    if (currentRoom && currentRoom.localParticipant) {
        try {
            await currentRoom.localParticipant.setCameraEnabled(!isVideoMuted);
        } catch (e) { console.error('LiveKit kamera değiştirilemedi', e); }
    }

    // 2. Yerel Akış Track Kamerası
    if (localStream) {
        localStream.getVideoTracks().forEach(track => {
            track.enabled = !isVideoMuted;
        });
    }

    if (DOM.videoBtn) {
        DOM.videoBtn.className = !isVideoMuted ? 'btn btn-primary px-3 fw-semibold' : 'btn btn-danger px-3 fw-semibold';
        DOM.videoBtn.innerHTML = !isVideoMuted ? '📹 Kamera Açık' : '📷 Kapalı';
    }
    showToast(!isVideoMuted ? '📹 Kamera açıldı.' : '📷 Kamera kapatıldı.', 'info');
}

// 4. AYGIT AYARLARI MODALI & TÜM DONANIM TESPİTİ (GİRİŞ/ÇIKIŞ FIX)
async function openDeviceSettingsModal() {
    try {
        // Etiketlerin boş çıkmaması için önce getUserMedia iznini tazeliyoruz
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => {});
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        if (DOM.micSelect) DOM.micSelect.innerHTML = '';
        if (DOM.cameraSelect) DOM.cameraSelect.innerHTML = '';
        if (DOM.speakerSelect) DOM.speakerSelect.innerHTML = '';

        let micCount = 1, camCount = 1, speakerCount = 1;

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;

            if (device.kind === 'audioinput' && DOM.micSelect) {
                option.text = device.label || `Mikrofon / Ses Girişi ${micCount++}`;
                DOM.micSelect.appendChild(option);
            } else if (device.kind === 'videoinput' && DOM.cameraSelect) {
                option.text = device.label || `Kamera ${camCount++}`;
                DOM.cameraSelect.appendChild(option);
            } else if (device.kind === 'audiooutput' && DOM.speakerSelect) {
                option.text = device.label || `Hoparlör / Kulaklık ${speakerCount++}`;
                DOM.speakerSelect.appendChild(option);
            }
        });

        const modalEl = document.getElementById('deviceSettingsModal');
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (err) {
        console.error('Aygıtlar tespit edilemedi:', err);
    }
}

async function changeAudioSource(deviceId) {
    await startLocalMedia(deviceId, DOM.cameraSelect ? DOM.cameraSelect.value : null);
    showToast('🎤 Mikrofon kaynağı güncellendi.', 'info');
}

async function changeVideoSource(deviceId) {
    await startLocalMedia(DOM.micSelect ? DOM.micSelect.value : null, deviceId);
    showToast('📹 Kamera kaynağı güncellendi.', 'info');
}

async function changeAudioOutput(deviceId) {
    if (DOM.localVideo && typeof DOM.localVideo.setSinkId === 'function') {
        try {
            await DOM.localVideo.setSinkId(deviceId);
            showToast('🔊 Ses çıkış cihazı güncellendi.', 'info');
        } catch (err) {
            console.error('Ses çıkışı değiştirilemedi:', err);
        }
    }
}

// 5. KATILIMCI EKLE / DAVET ET MODALI FIX
function openInviteModal() {
    loadSystemUsers();
    const modalEl = document.getElementById('inviteModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

async function loadSystemUsers() {
    try {
        const res = await fetch(`${API_BASE}/users/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            allUsersList = await res.json();
            
            if (DOM.taskAssigneeSelect) {
                DOM.taskAssigneeSelect.innerHTML = '<option value="">-- Kullanıcı Seçin --</option>';
                allUsersList.forEach(u => {
                    const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
                    DOM.taskAssigneeSelect.innerHTML += `<option value="${u.id}">${fullName} (${u.email})</option>`;
                });
            }

            renderUsersTable(allUsersList);
        }
    } catch (err) {
        console.error('Kullanıcı listesi çekilemedi:', err);
    }
}

function renderUsersTable(users) {
    if (!DOM.usersTableBody) return;
    if (!users || !users.length) {
        DOM.usersTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Kullanıcı bulunamadı.</td></tr>';
        return;
    }

    DOM.usersTableBody.innerHTML = users.map(u => {
        const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Kullanıcı';
        return `
            <tr>
                <td><strong>${escapeHtml(fullName)}</strong></td>
                <td><small class="text-muted">${escapeHtml(u.email)}</small></td>
                <td><code>${escapeHtml(u.user_code || '-')}</code></td>
                <td class="text-end">
                    <button class="btn btn-sm btn-primary fw-semibold" onclick="inviteUserToMeeting('${u.id}', '${u.email}')">
                        ➕ Davet Et
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterUsersTable() {
    const searchInput = document.getElementById('userSearchInput');
    if (!searchInput) return;
    const q = searchInput.value.toLowerCase();
    const filtered = allUsersList.filter(u => 
        (u.first_name && u.first_name.toLowerCase().includes(q)) ||
        (u.last_name && u.last_name.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q)
    );
    renderUsersTable(filtered);
}

async function inviteUserToMeeting(userId, email) {
    if (!currentMeetingId) return;

    try {
        const res = await fetch(`${API_BASE}/participants/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ meeting_id: currentMeetingId, user_id: userId, role: 'ATTENDEE' })
        });
        if (res.ok) {
            showToast(`📩 ${email} kişisine başarıyla davet gönderildi!`, 'success');
        } else {
            showToast('Davet gönderilemedi.', 'warning');
        }
    } catch (err) {
        console.error('Davet Hatası:', err);
    }
}

// 6. SOHBET (CHAT) FIX & REALTIME BAZLI GÖNDERİM
function setupSocket(meetingCode) {
    ws = new WebSocket(`ws://localhost:8000/api/v1/ws/${meetingCode}?token=${token}`);

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.event === 'CHAT_MESSAGE') {
                renderChatMessage(data.sender || 'Katılımcı', data.message, data.sender === currentUserInfo.name);
            } else if (data.event === 'NEW_TASK') {
                renderTaskItem(data.task);
            }
        } catch (e) { console.error('WS mesaj okuma hatası:', e); }
    };
}

function sendChatMessage() {
    const text = DOM.chatInput ? DOM.chatInput.value.trim() : '';
    if (!text) return;

    // Mesajı Ekrana Anında Bas (Sipariş Mantığı)
    renderChatMessage(currentUserInfo.name, text, true);

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            event: 'CHAT_MESSAGE',
            message: text,
            sender: currentUserInfo.name
        }));
    } else {
        showToast('Sohbet sunucusuna yeniden bağlanılıyor...', 'info');
    }

    DOM.chatInput.value = '';
}

function renderChatMessage(sender, text, isMe = false) {
    if (!DOM.chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `p-2 rounded mb-2 shadow-sm ${isMe ? 'chat-bubble-me align-self-end text-end' : 'chat-bubble-other align-self-start'}`;
    msgDiv.style.maxWidth = '85%';
    msgDiv.innerHTML = `<small class="d-block fw-bold opacity-75">${escapeHtml(sender)}</small><span>${escapeHtml(text)}</span>`;
    DOM.chatMessages.appendChild(msgDiv);
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

// 7. NOTLAR (AD SOYAD İLE KAYIT FIX)
async function addMeetingNote() {
    const text = DOM.noteInput ? DOM.noteInput.value.trim() : '';
    if (!text) {
        showToast('Lütfen bir not yazın.', 'warning');
        return;
    }

    const payload = { meeting_id: currentMeetingId, content: text };

    try {
        let res = await fetch(`${API_BASE}/notes/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            res = await fetch(`${API_BASE}/reports/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
        }

        if (res.ok) {
            renderNoteItem(text, currentUserInfo.name); // Tam Ad Soyad Basılıyor
            DOM.noteInput.value = '';
            showToast('📝 Not başarıyla eklendi.', 'success');
        }
    } catch (err) {
        console.error('Not ekleme hatası:', err);
    }
}

function renderNoteItem(content, author) {
    if (!DOM.notesList) return;
    const li = document.createElement('li');
    li.className = 'list-group-item bg-light border-0 rounded mb-2 shadow-sm p-2';
    li.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-1">
            <strong class="text-primary small">${escapeHtml(author)}</strong>
            <small class="text-muted">${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
        <div class="text-dark small">${escapeHtml(content)}</div>
    `;
    DOM.notesList.prepend(li);
}

// 8. EKRAN PAYLAŞIMI
async function toggleScreen() {
    if (currentRoom) {
        try {
            const isSharing = currentRoom.localParticipant.isScreenShareEnabled;
            await currentRoom.localParticipant.setScreenShareEnabled(!isSharing);
            showToast(!isSharing ? '🖥️ Ekran paylaşımı başlatıldı.' : '🖥️ Ekran paylaşımı durduruldu.', 'info');
            return;
        } catch (err) { console.error('LiveKit ekran paylaşım hatası:', err); }
    }

    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always", displaySurface: "monitor" },
            audio: true
        });

        const screenTrack = screenStream.getVideoTracks()[0];
        if (DOM.localVideo) {
            DOM.localVideo.srcObject = screenStream;
            DOM.localVideo.style.objectFit = 'contain';
        }
        if (DOM.userLabel) DOM.userLabel.textContent = `${currentUserInfo.name} (Ekran Paylaşımı)`;

        screenTrack.onended = () => stopScreenSharing();
        showToast('🖥️ Ekran paylaşımı başlatıldı.', 'success');
    } catch (err) {
        console.error('Ekran paylaşımı hatası:', err);
    }
}

function stopScreenSharing() {
    if (localStream) {
        if (DOM.localVideo) DOM.localVideo.srcObject = localStream;
        if (DOM.userLabel) DOM.userLabel.textContent = `${currentUserInfo.name} (Siz)`;
    }
    showToast('🖥️ Ekran paylaşımı kapatıldı.', 'info');
}

// 9. GÖREV ATAMA
async function assignTask() {
    const title = DOM.taskTitle ? DOM.taskTitle.value.trim() : '';
    const description = DOM.taskDescription ? DOM.taskDescription.value.trim() : '';
    const assignedTo = DOM.taskAssigneeSelect ? DOM.taskAssigneeSelect.value : '';

    if (!title) {
        showToast('⚠️ Lütfen görev başlığını giriniz.', 'warning');
        return;
    }

    const payload = {
        meeting_id: currentMeetingId,
        title: title,
        description: description || null,
        assigned_to: assignedTo || null,
        due_date: null
    };

    try {
        const res = await fetch(`${API_BASE}/actions/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const createdAction = await res.json();
            renderTaskItem(createdAction);

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ event: 'NEW_TASK', task: createdAction, sender: currentUserInfo.name }));
            }

            DOM.taskTitle.value = '';
            DOM.taskDescription.value = '';
            DOM.taskAssigneeSelect.value = '';
            showToast('✅ Görev başarıyla oluşturuldu ve atandı.', 'success');
        } else {
            showToast('Görev oluşturulamadı.', 'warning');
        }
    } catch (err) {
        console.error('Görev atama hatası:', err);
    }
}

function renderTaskItem(task) {
    if (!DOM.tasksList) return;
    const item = document.createElement('div');
    item.className = 'p-3 bg-light border rounded shadow-sm mb-2';
    const createdAtText = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
        <div class="fw-bold text-primary">📌 ${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="text-secondary small mt-1">${escapeHtml(task.description)}</div>` : ''}
        <div class="mt-2 pt-2 border-top text-muted small">
            <span>🕒 Saati: ${createdAtText}</span>
        </div>
    `;
    DOM.tasksList.prepend(item);
}

// 10. LIVEKIT BAĞLANTISI
async function connectToLiveKit(roomCode) {
    if (typeof LiveKitClient === 'undefined') return;

    try {
        const res = await fetch(`${API_BASE}/livekit/token/${roomCode}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) return;
        const { server_url, token: livekitToken } = await res.json();

        currentRoom = new LiveKitClient.Room({ adaptiveStream: true, dynacast: true });

        currentRoom.on(LiveKitClient.RoomEvent.TrackSubscribed, (track) => {
            if (track.kind === LiveKitClient.Track.Kind.Video) {
                const element = track.attach();
                element.style.objectFit = 'contain';
                element.style.width = '100%';
                element.style.height = '100%';
                document.getElementById('videoGrid')?.appendChild(element);
            }
        });

        currentRoom.on(LiveKitClient.RoomEvent.TrackUnsubscribed, (track) => {
            track.detach().forEach(el => el.remove());
        });

        await currentRoom.connect(server_url, livekitToken);
        await currentRoom.localParticipant.enableCameraAndMicrophone();

    } catch (err) {
        console.error('LiveKit Bağlantı Hatası:', err);
    }
}

// ARAYÜZ / UTILS
function toggleSidePanel(tabName = 'chat') {
    if (!DOM.sidePanel) return;
    if (DOM.sidePanel.classList.contains('d-none')) {
        DOM.sidePanel.classList.remove('d-none');
        DOM.sidePanel.classList.add('d-flex');
    }
    if (tabName) switchTab(tabName);
}

function switchTab(tab) {
    ['tabChat', 'tabNotes', 'tabTasks'].forEach(t => document.getElementById(t)?.classList.add('d-none'));
    ['tabBtnChat', 'tabBtnNotes', 'tabBtnTasks'].forEach(b => document.getElementById(b)?.classList.remove('active'));

    document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)?.classList.remove('d-none');
    document.getElementById(`tabBtn${tab.charAt(0).toUpperCase() + tab.slice(1)}`)?.classList.add('active');
}

function startTimer() {
    meetingTimer = setInterval(() => {
        activeSeconds++;
        const mins = String(Math.floor(activeSeconds / 60)).padStart(2, '0');
        const secs = String(activeSeconds % 60).padStart(2, '0');
        if (DOM.timerBadge) DOM.timerBadge.textContent = `${mins}:${secs}`;
    }, 1000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(msg, type = 'info') {
    const toastEl = document.getElementById('liveToast');
    if (!toastEl) return;
    const colors = { success: 'bg-success text-white', warning: 'bg-warning text-dark', info: 'bg-primary text-white' };
    toastEl.className = `toast border-0 shadow ${colors[type] || 'bg-primary text-white'}`;
    document.getElementById('toastMessage').textContent = msg;
    bootstrap.Toast.getOrCreateInstance(toastEl).show();
}

async function leaveRoom() {
    if (confirm('Toplantıdan ayrılmak istiyor musunuz?')) {
        clearInterval(meetingTimer);
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        if (currentRoom) currentRoom.disconnect();
        window.location.href = '/dashboard';
    }
}

document.addEventListener('DOMContentLoaded', initRoom);
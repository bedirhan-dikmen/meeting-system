// ============================================
// ROOM.JS - TAM İŞLEVLİ CANLI ODA & DONANIM YÖNETİMİ
// ============================================

const API_BASE = 'http://localhost:8000/api/v1';
const token = localStorage.getItem('token');

let localStream = null;
let meetingTimer = null;
let activeSeconds = 0;
let meetingCode = null;
let currentMeetingId = null;
let ws = null;
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

// 1. USER BİLGİSİ
function parseUserInfo() {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUserInfo.id = payload.sub || payload.user_id || '';
        currentUserInfo.email = payload.email || '';
        const fn = payload.first_name || '';
        const ln = payload.last_name || '';
        if (fn || ln) currentUserInfo.name = `${fn} ${ln}`.trim();
        else if (currentUserInfo.email) currentUserInfo.name = currentUserInfo.email.split('@')[0];
    } catch (e) { console.error('Token parse hatası', e); }
}

// 2. ODA BAŞLAT
async function initRoom() {
    parseUserInfo();
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

        currentMeetingId = data.id;
        if (DOM.roomTitle) DOM.roomTitle.textContent = data.title || 'Toplantı Odası';
        if (DOM.roomCode) DOM.roomCode.textContent = `Kod: ${data.meeting_code}`;

        await startLocalMedia();
        startTimer();
        loadSystemUsers();
        setupSocket(meetingCode);

    } catch (err) {
        showToast('Oda yüklenirken hata: ' + err.message, 'warning');
    }
}

// 3. MEDYA VE DONANIM AYGITLARINI TESPİT ETME / DEĞİŞTİRME
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
        showToast('⚠️ Kamera/Mikrofon erişimi engellendi.', 'warning');
    }
}

// AYGIT LİSTESİNİ ÇEK VE MODALDA GÖSTER
async function openDeviceSettingsModal() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        if (DOM.micSelect) DOM.micSelect.innerHTML = '';
        if (DOM.cameraSelect) DOM.cameraSelect.innerHTML = '';
        if (DOM.speakerSelect) DOM.speakerSelect.innerHTML = '';

        let micCount = 1, camCount = 1, speakerCount = 1;

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;

            if (device.kind === 'audioinput' && DOM.micSelect) {
                option.text = device.label || `Mikrofon ${micCount++}`;
                DOM.micSelect.appendChild(option);
            } else if (device.kind === 'videoinput' && DOM.cameraSelect) {
                option.text = device.label || `Kamera ${camCount++}`;
                DOM.cameraSelect.appendChild(option);
            } else if (device.kind === 'audiooutput' && DOM.speakerSelect) {
                option.text = device.label || `Hoparlör ${speakerCount++}`;
                DOM.speakerSelect.appendChild(option);
            }
        });

        new bootstrap.Modal(document.getElementById('deviceSettingsModal')).show();
    } catch (err) {
        console.error('Aygıtlar tespit edilemedi:', err);
    }
}

async function changeAudioSource(deviceId) {
    await startLocalMedia(deviceId, DOM.cameraSelect ? DOM.cameraSelect.value : null);
    showToast('🎤 Mikrofon değiştirildi.', 'info');
}

async function changeVideoSource(deviceId) {
    await startLocalMedia(DOM.micSelect ? DOM.micSelect.value : null, deviceId);
    showToast('📹 Kamera değiştirildi.', 'info');
}

async function changeAudioOutput(deviceId) {
    if (DOM.localVideo && typeof DOM.localVideo.setSinkId === 'function') {
        try {
            await DOM.localVideo.setSinkId(deviceId);
            showToast('🔊 Ses çıkış cihazı güncellendi.', 'info');
        } catch (err) {
            console.error('Ses çıkışı ayarlanamadı:', err);
        }
    }
}

function toggleAudio() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        if (DOM.audioBtn) {
            DOM.audioBtn.className = audioTrack.enabled ? 'btn btn-primary px-3 fw-semibold' : 'btn btn-danger px-3 fw-semibold';
            DOM.audioBtn.innerHTML = audioTrack.enabled ? '🎤 Ses Açık' : '🔇 Sessiz';
        }
    }
}

function toggleVideo() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        if (DOM.videoBtn) {
            DOM.videoBtn.className = videoTrack.enabled ? 'btn btn-primary px-3 fw-semibold' : 'btn btn-danger px-3 fw-semibold';
            DOM.videoBtn.innerHTML = videoTrack.enabled ? '📹 Kamera Açık' : '📷 Kapalı';
        }
    }
}

// 4. EKRAN PAYLAŞIMI
async function toggleScreen() {
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
        console.error('Ekran paylaşımı başlatılamadı:', err);
    }
}

function stopScreenSharing() {
    if (localStream) {
        if (DOM.localVideo) DOM.localVideo.srcObject = localStream;
        if (DOM.userLabel) DOM.userLabel.textContent = `${currentUserInfo.name} (Siz)`;
    }
    showToast('🖥️ Ekran paylaşımı kapatıldı.', 'info');
}

// 5. GÖREV ATAMA (SADELEŞTİRİLMİŞ - HATA SIFIRLANDI)
async function assignTask() {
    const title = DOM.taskTitle ? DOM.taskTitle.value.trim() : '';
    const description = DOM.taskDescription ? DOM.taskDescription.value.trim() : '';
    const assignedTo = DOM.taskAssigneeSelect ? DOM.taskAssigneeSelect.value : '';

    if (!title) {
        showToast('⚠️ Lütfen görev başlığı giriniz.', 'warning');
        return;
    }

    const payload = {
        meeting_id: currentMeetingId,
        title: title,
        description: description || null,
        assigned_to: assignedTo || null,
        due_date: null // Hataları önlemek için null olarak sabitlendi
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

// 6. TOPLANTIDA NOT ALMA
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
            renderNoteItem(text, currentUserInfo.name);
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

// 7. KATILIMCI YÖNETİMİ & WEBSOCKET
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
                    const fn = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;
                    DOM.taskAssigneeSelect.innerHTML += `<option value="${u.id}">${fn} (${u.email})</option>`;
                });
            }
            renderUsersTable(allUsersList);
        }
    } catch (err) { console.error(err); }
}

function openInviteModal() { new bootstrap.Modal(document.getElementById('inviteModal')).show(); }

function renderUsersTable(users) {
    if (!DOM.usersTableBody) return;
    DOM.usersTableBody.innerHTML = users.map(u => `
        <tr>
            <td><strong>${escapeHtml(`${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Kullanıcı')}</strong></td>
            <td><small class="text-muted">${escapeHtml(u.email)}</small></td>
            <td><code>${escapeHtml(u.user_code || '-')}</code></td>
            <td class="text-end">
                <button class="btn btn-sm btn-primary fw-semibold" onclick="inviteUserToMeeting('${u.id}', '${u.email}')">➕ Davet Et</button>
            </td>
        </tr>
    `).join('');
}

function filterUsersTable() {
    const q = document.getElementById('userSearchInput').value.toLowerCase();
    renderUsersTable(allUsersList.filter(u => 
        (u.first_name && u.first_name.toLowerCase().includes(q)) ||
        (u.last_name && u.last_name.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q)
    ));
}

async function inviteUserToMeeting(userId, email) {
    try {
        const res = await fetch(`${API_BASE}/participants/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ meeting_id: currentMeetingId, user_id: userId, role: 'ATTENDEE' })
        });
        if (res.ok) showToast(`📩 ${email} adresine bildirim gönderildi!`, 'success');
    } catch (err) { console.error(err); }
}

function setupSocket(meetingCode) {
    ws = new WebSocket(`ws://localhost:8000/api/v1/ws/${meetingCode}?token=${token}`);
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.event === 'CHAT_MESSAGE') renderChatMessage(data.sender || 'Katılımcı', data.message, data.sender === currentUserInfo.name);
            else if (data.event === 'NEW_TASK') renderTaskItem(data.task);
        } catch (e) {}
    };
}

function sendChatMessage() {
    const text = DOM.chatInput ? DOM.chatInput.value.trim() : '';
    if (!text) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'CHAT_MESSAGE', message: text, sender: currentUserInfo.name }));
        renderChatMessage(currentUserInfo.name, text, true);
        DOM.chatInput.value = '';
    }
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

// UI UTILS
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
    new bootstrap.Toast(toastEl).show();
}

async function leaveRoom() {
    if (confirm('Toplantıdan ayrılmak istiyor musunuz?')) {
        clearInterval(meetingTimer);
        if (localStream) localStream.getTracks().forEach(track => track.stop());
        window.location.href = '/dashboard';
    }
}

document.addEventListener('DOMContentLoaded', initRoom);
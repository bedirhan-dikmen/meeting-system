// ============================================
// DASHBOARD.JS - KURUMSAL PANEL & TOPLANTI KONTROL
// ============================================

console.log('🚀 Dashboard.js yüklendi');

const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/';
}

const API_BASE = 'http://localhost:8000/api/v1';

const DOM = {
    meetingList: document.getElementById('meetingList'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    meetingTitle: document.getElementById('meetingTitle'),
    scheduledStart: document.getElementById('scheduledStart'),
    scheduledEnd: document.getElementById('scheduledEnd'),
    createBtn: document.getElementById('createBtn'),
    userInfo: document.getElementById('userInfo'),
    toast: document.getElementById('liveToast'),
    toastMessage: document.getElementById('toastMessage')
};

// 1. KULLANICI BİLGİSİNİ GÖSTER
async function showUserInfo() {
    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
            if (DOM.userInfo) DOM.userInfo.textContent = `👋 ${fullName}`;
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
        if (DOM.userInfo) DOM.userInfo.textContent = `👋 ${payload.sub || 'Kullanıcı'}`;
    } catch (e) {
        if (DOM.userInfo) DOM.userInfo.textContent = '👤 Kullanıcı';
    }
}

// 2. TOPLANTILARI LİSTELE
async function loadMeetings() {
    if (DOM.loadingIndicator) DOM.loadingIndicator.classList.remove('d-none');

    try {
        const res = await fetch(`${API_BASE}/meetings/`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            if (res.status === 401) {
                localStorage.removeItem('token');
                window.location.href = '/';
                return;
            }
            throw new Error('Toplantı listesi alınamadı.');
        }

        const meetings = await res.json();
        renderMeetingsTable(meetings);

    } catch (err) {
        console.error('Listeleme hatası:', err);
        showToast('Toplantılar yüklenirken hata oluştu.', 'error');
    } finally {
        if (DOM.loadingIndicator) DOM.loadingIndicator.classList.add('d-none');
    }
}

function renderMeetingsTable(meetings) {
    if (!DOM.meetingList) return;

    if (!meetings || meetings.length === 0) {
        DOM.meetingList.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-muted py-4">
                    Henüz kayıtlı bir toplantı bulunmuyor. Yeni bir oda oluşturabilirsiniz.
                </td>
            </tr>
        `;
        return;
    }

    DOM.meetingList.innerHTML = meetings.map(m => {
        const isLive = m.is_active;
        const statusBadge = isLive 
            ? `<span class="badge bg-success">🔴 Canlı / Aktif</span>` 
            : `<span class="badge bg-secondary">🏁 Tamamlandı</span>`;

        const actionButton = isLive
            ? `<button onclick="joinMeetingRoom('${m.meeting_code}')" class="btn btn-sm btn-primary fw-semibold">🚀 Odaya Katıl</button>`
            : `<button onclick="window.location.href='/report/${m.id}'" class="btn btn-sm btn-outline-primary fw-semibold">📊 Raporu Gör</button>`;

        const startTime = m.scheduled_start 
            ? new Date(m.scheduled_start).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
            : '-';

        return `
            <tr>
                <td><strong>${escapeHtml(m.title)}</strong></td>
                <td><code>${escapeHtml(m.meeting_code)}</code></td>
                <td><small>${startTime}</small></td>
                <td>${statusBadge}</td>
                <td class="text-end">${actionButton}</td>
            </tr>
        `;
    }).join('');
}

// 3. ODALARA KATILMA SAAT KONTROLÜ
async function joinMeetingRoom(meetingCode) {
    try {
        const res = await fetch(`${API_BASE}/meetings/code/${meetingCode}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
            showToast('Toplantı bulunamadı.', 'error');
            return;
        }

        const meeting = await res.json();

        // Toplantı pasifse rapora yönlendir
        if (!meeting.is_active) {
            showToast('🏁 Bu toplantı sonlandırılmıştır. Rapor ekranına gidiliyor...', 'warning');
            setTimeout(() => { window.location.href = `/report/${meeting.id}`; }, 1200);
            return;
        }

        // Zaman Kontrolü (Toplantı saati gelmiş mi?)
        const now = new Date();
        const scheduledStart = meeting.scheduled_start ? new Date(meeting.scheduled_start) : null;

        if (scheduledStart && now < scheduledStart) {
            const timeStr = scheduledStart.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const dateStr = scheduledStart.toLocaleDateString('tr-TR');
            if (!confirm(`⏳ Bu toplantının planlanan başlangıç saati henüz gelmemiştir.\n\nPlanlanan Saat: ${dateStr} - ${timeStr}\n\nYine de erken giriş yapmak istiyor musunuz?`)) {
                return;
            }
        }

        window.location.href = `/room/${meetingCode}`;

    } catch (err) {
        console.error('Odaya katılım hatası:', err);
    }
}

// 4. YENİ TOPLANTI OLUŞTURMA
async function createMeeting(e) {
    if (e) e.preventDefault();

    const title = DOM.meetingTitle ? DOM.meetingTitle.value.trim() : '';
    const startVal = DOM.scheduledStart ? DOM.scheduledStart.value : null;
    const endVal = DOM.scheduledEnd ? DOM.scheduledEnd.value : null;

    if (!title) {
        showToast('Lütfen toplantı başlığını giriniz.', 'warning');
        return;
    }

    const payload = {
        title: title,
        description: "Kurumsal Canlı Toplantı",
        scheduled_start: startVal ? new Date(startVal).toISOString() : new Date().toISOString(),
        scheduled_end: endVal ? new Date(endVal).toISOString() : new Date(Date.now() + 3600000).toISOString()
    };

    try {
        if (DOM.createBtn) DOM.createBtn.disabled = true;

        const res = await fetch(`${API_BASE}/meetings/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const newMeeting = await res.json();
            showToast('🎉 Toplantı odası başarıyla oluşturuldu!', 'success');
            
            if (DOM.meetingTitle) DOM.meetingTitle.value = '';
            if (DOM.scheduledStart) DOM.scheduledStart.value = '';
            if (DOM.scheduledEnd) DOM.scheduledEnd.value = '';

            loadMeetings();
            
            // Modal varsa kapat
            const modalEl = document.getElementById('createMeetingModal');
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }
        } else {
            const errData = await res.json();
            showToast(`Oda oluşturulamadı: ${errData.detail || ''}`, 'error');
        }
    } catch (err) {
        console.error('Oda oluşturma hatası:', err);
        showToast('Sunucu bağlantı hatası!', 'error');
    } finally {
        if (DOM.createBtn) DOM.createBtn.disabled = false;
    }
}

// UTILS & EVENTS
function logout() {
    localStorage.removeItem('token');
    window.location.href = '/';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    const toastEl = DOM.toast || document.getElementById('liveToast');
    if (!toastEl) return;
    const colors = { success: 'bg-success text-white', error: 'bg-danger text-white', warning: 'bg-warning text-dark', info: 'bg-info text-dark' };
    toastEl.className = `toast border-0 shadow ${colors[type] || 'bg-primary text-white'}`;
    if (DOM.toastMessage) DOM.toastMessage.textContent = message;
    bootstrap.Toast.getOrCreateInstance(toastEl).show();
}

document.addEventListener('DOMContentLoaded', () => {
    showUserInfo();
    loadMeetings();

    const createForm = document.getElementById('createMeetingForm');
    if (createForm) {
        createForm.addEventListener('submit', createMeeting);
    }
});
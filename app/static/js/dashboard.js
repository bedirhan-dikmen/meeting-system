// ============================================
// DASHBOARD.JS - VERSION 2.0
// ============================================

console.log('🚀 Dashboard.js v2.0 yüklendi');

// ===== AUTH KONTROL =====
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/';
}

// ===== SABİTLER =====
const API_BASE = 'http://localhost:8000/api/v1';

// ===== DOM REFERANSLARI =====
const DOM = {
    meetingList: document.getElementById('meetingList'),
    loadingIndicator: document.getElementById('loadingIndicator'),
    meetingTitle: document.getElementById('meetingTitle'),
    meetingDuration: document.getElementById('meetingDuration'),
    createBtn: document.getElementById('createBtn'),
    createBtnText: document.getElementById('createBtnText'),
    createBtnSpinner: document.getElementById('createBtnSpinner'),
    createStatus: document.getElementById('createStatus'),
    userInfo: document.getElementById('userInfo'),
    toast: document.getElementById('liveToast'),
    toastMessage: document.getElementById('toastMessage')
};

// ===== TOAST BİLDİRİM =====
let toastInstance = null;

function showToast(message, type = 'success', duration = 4000) {
    const colors = {
        success: 'bg-success',
        error: 'bg-danger',
        warning: 'bg-warning',
        info: 'bg-info'
    };
    
    if (!DOM.toast) {
        console.log('📢', message);
        return;
    }
    
    DOM.toast.className = `toast align-items-center text-white border-0 ${colors[type] || 'bg-primary'}`;
    DOM.toastMessage.textContent = message;
    
    if (!toastInstance) {
        toastInstance = new bootstrap.Toast(DOM.toast, {
            animation: true,
            autohide: true,
            delay: duration
        });
    }
    toastInstance.show();
}

// ===== HTML ESCAPE =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== KOD KOPYALA =====
function copyCode(code) {
    if (!code) return;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            showToast(`📋 "${code}" kodu kopyalandı!`, 'success');
        }).catch(() => fallbackCopy(code));
    } else {
        fallbackCopy(code);
    }
}

function fallbackCopy(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    try {
        document.execCommand('copy');
        showToast(`📋 "${text}" kodu kopyalandı!`, 'success');
    } catch (e) {
        showToast('❌ Kopyalanamadı, manuel kopyalayın.', 'error');
    }
    document.body.removeChild(input);
}

// ===== TOPLANTILARI YÜKLE =====
async function loadMeetings() {
    const list = DOM.meetingList;
    const loading = DOM.loadingIndicator;
    
    loading.classList.remove('d-none');
    list.innerHTML = '';
    
    try {
        const res = await fetch(`${API_BASE}/meetings/`, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        });

        if (!res.ok) {
            if (res.status === 401) {
                localStorage.removeItem('token');
                window.location.href = '/';
                return;
            }
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const meetings = Array.isArray(data) ? data : (data.items || []);

        if (meetings.length === 0) {
            list.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-5">
                        <div class="empty-state">
                            <div class="icon">📭</div>
                            <h6>Aktif Toplantı Bulunamadı</h6>
                            <p class="text-muted">Hemen yeni bir toplantı odası oluşturun</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        meetings.sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));

        meetings.forEach((m, index) => {
            const startDate = new Date(m.scheduled_start);
            const endDate = m.scheduled_end ? new Date(m.scheduled_end) : null;
            
            const formattedDate = startDate.toLocaleDateString('tr-TR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const formattedEnd = endDate ? endDate.toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit'
            }) : '-';
            
            const isActive = m.is_active !== false;
            const statusClass = isActive ? 'active' : 'passive';
            const statusText = isActive ? 'Aktif' : 'Pasif';

            list.innerHTML += `
                <tr>
                    <td>
                        <div class="fw-semibold text-white">${escapeHtml(m.title)}</div>
                        <small class="text-muted">${escapeHtml(m.description || '')}</small>
                    </td>
                    <td>
                        <span class="code-badge">${m.meeting_code}</span>
                        <button onclick="copyCode('${m.meeting_code}')" 
                                class="btn btn-sm btn-outline-secondary ms-1" 
                                title="Kodu Kopyala">
                            📋
                        </button>
                    </td>
                    <td>
                        <div>${formattedDate}</div>
                        <small class="text-muted">⏱️ ${formattedEnd}</small>
                    </td>
                    <td>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </td>
                    <td>
                        <a href="/room/${m.meeting_code}" 
                           class="btn btn-success-custom me-1">
                           🚪 Katıl
                        </a>
                        <a href="/report/${m.id}" 
                           class="btn btn-outline-light-custom">
                           📊 Rapor
                        </a>
                    </td>
                </tr>
            `;
        });

    } catch (err) {
        console.error('Toplantı listesi yüklenemedi:', err);
        showToast('Toplantılar yüklenirken bir hata oluştu!', 'error');
        list.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-danger py-4">
                    ⚠️ Toplantılar yüklenirken hata oluştu.
                    <br>
                    <button onclick="loadMeetings()" class="btn btn-sm btn-outline-secondary mt-2">
                        🔄 Yeniden Dene
                    </button>
                </td>
            </tr>
        `;
    } finally {
        loading.classList.add('d-none');
    }
}

// ===== TOPLANTI OLUŞTUR =====
async function createNewMeeting() {
    const title = DOM.meetingTitle.value.trim();
    
    if (!title) {
        showToast('⚠️ Lütfen bir toplantı başlığı girin.', 'warning');
        DOM.meetingTitle.focus();
        return;
    }

    if (title.length < 3) {
        showToast('⚠️ Başlık en az 3 karakter olmalı.', 'warning');
        return;
    }

    DOM.createBtn.disabled = true;
    DOM.createBtnText.textContent = 'Oluşturuluyor...';
    DOM.createBtnSpinner.classList.remove('d-none');
    DOM.createStatus.textContent = '⏳ Toplantı oluşturuluyor...';
    DOM.createStatus.className = 'mt-2 small text-warning';

    const now = new Date();
    const durationMinutes = parseInt(DOM.meetingDuration.value);
    const endTime = new Date(now.getTime() + durationMinutes * 60000);

    const payload = {
        title: title,
        description: 'Teams Stilinde Kurumsal Canlı Toplantı',
        scheduled_start: now.toISOString(),
        scheduled_end: endTime.toISOString()
    };

    console.log('📤 Gönderilen payload:', payload);

    try {
        const res = await fetch(`${API_BASE}/meetings/`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            console.log('✅ Başarılı:', data);
            
            DOM.meetingTitle.value = '';
            DOM.createStatus.textContent = `✅ "${title}" toplantısı oluşturuldu! Kod: ${data.meeting_code}`;
            DOM.createStatus.className = 'mt-2 small text-success';
            
            showToast(`✅ "${title}" toplantısı başarıyla oluşturuldu!`, 'success');
            loadMeetings();
            
            setTimeout(() => {
                if (confirm(`"${title}" toplantısı oluşturuldu.\nOda koduna hemen katılmak ister misiniz?\nKod: ${data.meeting_code}`)) {
                    window.location.href = `/room/${data.meeting_code}`;
                }
            }, 1000);
            
        } else {
            let errorMsg = 'Oda oluşturulamadı!';
            try {
                const errData = await res.json();
                console.error('❌ Hata detayı:', errData);
                
                if (errData.detail) {
                    if (Array.isArray(errData.detail)) {
                        errorMsg = errData.detail.map(e => {
                            const field = e.loc.join('.');
                            return `${field}: ${e.msg}`;
                        }).join('\n');
                    } else {
                        errorMsg = errData.detail;
                    }
                }
            } catch (e) {
                errorMsg = `HTTP ${res.status}: ${res.statusText}`;
            }
            
            DOM.createStatus.textContent = `❌ ${errorMsg}`;
            DOM.createStatus.className = 'mt-2 small text-danger';
            showToast(`❌ ${errorMsg}`, 'error');
        }
        
    } catch (err) {
        console.error('🌐 Ağ hatası:', err);
        DOM.createStatus.textContent = '🌐 Ağ bağlantısı hatası!';
        DOM.createStatus.className = 'mt-2 small text-danger';
        showToast('🌐 Sunucuya bağlanılamıyor!', 'error');
        
    } finally {
        DOM.createBtn.disabled = false;
        DOM.createBtnText.textContent = 'Oda Oluştur';
        DOM.createBtnSpinner.classList.add('d-none');
        
        setTimeout(() => {
            DOM.createStatus.textContent = '';
            DOM.createStatus.className = 'mt-2 small';
        }, 5000);
    }
}

// ===== ÇIKIŞ =====
function logout() {
    if (confirm('Çıkış yapmak istediğinize emin misiniz?')) {
        localStorage.removeItem('token');
        sessionStorage.clear();
        showToast('👋 Başarıyla çıkış yapıldı.', 'info');
        setTimeout(() => {
            window.location.href = '/';
        }, 500);
    }
}

// ===== KULLANICI BİLGİSİNİ GÖSTER =====
function showUserInfo() {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.sub) {
            DOM.userInfo.textContent = `👋 ${payload.sub}`;
        }
        if (payload.email) {
            DOM.userInfo.title = payload.email;
        }
    } catch (e) {
        DOM.userInfo.textContent = '👤 Kullanıcı';
    }
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        DOM.meetingTitle.focus();
        DOM.meetingTitle.select();
    }
    if (e.ctrlKey && e.key === 'r') {
        e.preventDefault();
        loadMeetings();
        showToast('🔄 Toplantılar yenilendi.', 'info');
    }
});

// ===== SAYFA YÜKLENDİĞİNDE =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM yüklendi');
    
    showUserInfo();
    loadMeetings();
    
    DOM.meetingTitle.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createNewMeeting();
        }
    });
    
    setInterval(loadMeetings, 60000);
    
    setTimeout(() => {
        DOM.meetingTitle.focus();
    }, 500);
});

// ===== GLOBAL EXPOSE =====
window.createNewMeeting = createNewMeeting;
window.loadMeetings = loadMeetings;
window.logout = logout;
window.copyCode = copyCode;
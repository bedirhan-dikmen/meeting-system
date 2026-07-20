// ============================================
// ROOM.JS - VERSION 2.0
// ============================================

console.log('🚪 Room.js v2.0 yüklendi');

// ===== SABİTLER =====
const API_BASE = 'http://localhost:8000/api/v1';
const token = localStorage.getItem('token');

if (!token) {
    window.location.href = '/';
}

// ===== DOM REFERANSLARI =====
const DOM = {
    roomTitle: document.getElementById('roomTitle'),
    roomCode: document.getElementById('roomCode'),
    roomStatus: document.getElementById('roomStatus'),
    videoGrid: document.getElementById('videoGrid'),
    audioBtn: document.getElementById('audioBtn'),
    videoBtn: document.getElementById('videoBtn'),
    screenBtn: document.getElementById('screenBtn')
};

// ===== ODA BİLGİSİNİ YÜKLE =====
async function loadRoomInfo() {
    const path = window.location.pathname;
    const code = path.split('/').pop();
    
    if (!code || code === 'room') {
        window.location.href = '/dashboard';
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/meetings/code/${code}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            DOM.roomTitle.textContent = data.title || 'Toplantı Odası';
            DOM.roomCode.textContent = `Kod: ${data.meeting_code}`;
            
            // Status güncelle
            const now = new Date();
            const start = new Date(data.scheduled_start);
            const end = new Date(data.scheduled_end);
            
            if (now < start) {
                DOM.roomStatus.textContent = '⏳ Bekliyor';
                DOM.roomStatus.className = 'badge bg-warning';
            } else if (now > end) {
                DOM.roomStatus.textContent = '✅ Tamamlandı';
                DOM.roomStatus.className = 'badge bg-secondary';
            } else {
                DOM.roomStatus.textContent = '🔴 Canlı';
                DOM.roomStatus.className = 'badge bg-success';
            }
        } else {
            showToast('Toplantı bulunamadı!', 'error');
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 2000);
        }
    } catch (err) {
        console.error('Oda bilgisi yüklenemedi:', err);
        showToast('Bağlantı hatası!', 'error');
    }
}

// ===== SES KONTROL =====
function toggleAudio() {
    DOM.audioBtn.classList.toggle('active');
    const isMuted = DOM.audioBtn.classList.contains('active');
    DOM.audioBtn.textContent = isMuted ? '🔇 Sessiz' : '🎤 Ses';
    showToast(isMuted ? 'Mikrofon kapatıldı' : 'Mikrofon açıldı', 'info');
}

// ===== KAMERA KONTROL =====
function toggleVideo() {
    DOM.videoBtn.classList.toggle('active');
    const isOff = DOM.videoBtn.classList.contains('active');
    DOM.videoBtn.textContent = isOff ? '📷 Kapalı' : '📹 Kamera';
    showToast(isOff ? 'Kamera kapatıldı' : 'Kamera açıldı', 'info');
}

// ===== EKRAN PAYLAŞIM =====
function toggleScreen() {
    DOM.screenBtn.classList.toggle('active');
    const isSharing = DOM.screenBtn.classList.contains('active');
    DOM.screenBtn.textContent = isSharing ? '🖥️ Paylaşılıyor' : '🖥️ Paylaş';
    showToast(isSharing ? 'Ekran paylaşımı başlatıldı' : 'Ekran paylaşımı durduruldu', 'info');
}

// ===== KATILIMCILAR =====
function showParticipants() {
    showToast('👥 Katılımcı listesi yakında...', 'info');
}

// ===== SOHBET =====
function showChat() {
    showToast('💬 Sohbet özelliği yakında...', 'info');
}

// ===== ODADAN ÇIK =====
function leaveRoom() {
    if (confirm('Toplantıdan çıkmak istediğinize emin misiniz?')) {
        showToast('👋 Toplantıdan çıkılıyor...', 'info');
        setTimeout(() => {
            window.location.href = '/dashboard';
        }, 500);
    }
}

// ===== TOAST =====
function showToast(message, type = 'success') {
    const toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white border-0 ${type === 'error' ? 'bg-danger' : type === 'info' ? 'bg-info' : 'bg-success'}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    toastContainer.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
    bsToast.show();
    setTimeout(() => toast.remove(), 3500);
}

// ===== SAYFA YÜKLENDİĞİNDE =====
document.addEventListener('DOMContentLoaded', () => {
    loadRoomInfo();
});

// ===== GLOBAL EXPOSE =====
window.toggleAudio = toggleAudio;
window.toggleVideo = toggleVideo;
window.toggleScreen = toggleScreen;
window.showParticipants = showParticipants;
window.showChat = showChat;
window.leaveRoom = leaveRoom;
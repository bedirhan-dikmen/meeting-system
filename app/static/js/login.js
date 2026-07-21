// ============================================
// LOGIN.JS - VERSION 2.3 (Form-Data ile)
// ============================================

console.log('🔐 Login.js v2.3 yüklendi');

// ===== SABİTLER =====
const API_BASE = 'http://localhost:8000/api/v1';

// ===== DOM REFERANSLARI =====
const DOM = {
    form: document.getElementById('loginForm'),
    email: document.getElementById('email'),
    password: document.getElementById('password'),
    error: document.getElementById('loginError'),
    btn: document.getElementById('loginBtn'),
    btnText: document.getElementById('loginBtnText'),
    spinner: document.getElementById('loginSpinner')
};

// ===== TOAST BİLDİRİM =====
function showToast(message, type = 'success') {
    const container = document.querySelector('.toast-container');
    if (!container) {
        const newContainer = document.createElement('div');
        newContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        document.body.appendChild(newContainer);
        return showToast(message, type);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white border-0 ${type === 'error' ? 'bg-danger' : 'bg-success'}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
    bsToast.show();
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 3500);
}

// ===== GİRİŞ YAP =====
async function handleLogin(e) {
    e.preventDefault();
    
    const email = DOM.email.value.trim();
    const password = DOM.password.value.trim();
    
    // Validasyon
    if (!email || !password) {
        DOM.error.textContent = '⚠️ Lütfen tüm alanları doldurun.';
        DOM.error.classList.add('show');
        return;
    }
    
    if (!email.includes('@')) {
        DOM.error.textContent = '⚠️ Geçerli bir email adresi girin.';
        DOM.error.classList.add('show');
        return;
    }
    
    // Buton durumu
    DOM.btn.disabled = true;
    DOM.btnText.textContent = 'Giriş Yapılıyor...';
    DOM.spinner.classList.remove('d-none');
    DOM.error.classList.remove('show');
    
    try {
        // ===== FORM-DATA OLUŞTUR (Backend OAuth2PasswordRequestForm bekliyor) =====
        const formData = new FormData();
        formData.append('username', email);   // email'i username olarak gönder
        formData.append('password', password);
        
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            body: formData   // Content-Type: multipart/form-data otomatik ayarlanır
        });
        
        if (res.ok) {
            const data = await res.json();
            console.log('✅ Giriş başarılı:', data);
            
            if (data.access_token) {
                localStorage.setItem('token', data.access_token);
            }
            if (data.role) {
                localStorage.setItem('role', data.role);
            }
            
            showToast('✅ Giriş başarılı! Yönlendiriliyorsunuz...', 'success');
            
            setTimeout(() => {
                window.location.href = '/dashboard';
            }, 800);
            
        } else {
            let errorMsg = 'Giriş başarısız!';
            try {
                const errData = await res.json();
                if (errData.detail) {
                    if (typeof errData.detail === 'string') {
                        errorMsg = errData.detail;
                    } else if (Array.isArray(errData.detail)) {
                        errorMsg = errData.detail.map(e => `${e.loc.join('.')}: ${e.msg}`).join('\n');
                    } else {
                        errorMsg = JSON.stringify(errData.detail);
                    }
                }
            } catch (e) {
                errorMsg = `HTTP ${res.status}: ${res.statusText}`;
            }
            
            DOM.error.textContent = `❌ ${errorMsg}`;
            DOM.error.classList.add('show');
            
            DOM.password.value = '';
            DOM.password.focus();
        }
        
    } catch (err) {
        console.error('🌐 Ağ hatası:', err);
        DOM.error.textContent = '🌐 Sunucuya bağlanılamıyor! Lütfen sunucunun çalıştığından emin olun.';
        DOM.error.classList.add('show');
        
    } finally {
        DOM.btn.disabled = false;
        DOM.btnText.textContent = 'Giriş Yap';
        DOM.spinner.classList.add('d-none');
    }
}

// ===== SAYFA YÜKLENDİĞİNDE =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 Login sayfası yüklendi');
    
    const token = localStorage.getItem('token');
    if (token) {
        fetch(`${API_BASE}/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (res.ok) {
                window.location.href = '/dashboard';
            } else {
                localStorage.removeItem('token');
            }
        })
        .catch(() => {
            localStorage.removeItem('token');
        });
    }
    
    DOM.form.addEventListener('submit', handleLogin);
    
    DOM.password.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleLogin(e);
        }
    });
    
    DOM.email.addEventListener('input', () => {
        DOM.error.classList.remove('show');
    });
    DOM.password.addEventListener('input', () => {
        DOM.error.classList.remove('show');
    });
});

// ===== GLOBAL EXPOSE =====
window.handleLogin = handleLogin;
/* ==========================================================================
   AUTH & SYSTEM HELPER MODULE
   ========================================================================== */

const Auth = {
  getToken() {
    return localStorage.getItem('access_token');
  },

  getUser() {
    const userStr = localStorage.getItem('user_info');
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch {
      return null;
    }
  },

  getCurrentUser() {
    return this.getUser();
  },

  saveAuth(token, user) {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user_info', JSON.stringify(user));
    document.cookie = `access_token=${token}; path=/; max-age=86400; SameSite=Lax`;
  },

  logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_info');
    document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    window.location.replace('/login');
  },

  requireAuth() {
    const path = window.location.pathname;
    const urlParams = new URLSearchParams(window.location.search);
    const guestToken = urlParams.get('guest_token') || sessionStorage.getItem('guest_token');

    // Misafir rotaları için yönlendirme yapma
    if (path.startsWith('/guest/')) {
      return;
    }

    // Toplantı odası rotası (/room/{meeting_code})
    if (path.startsWith('/room/')) {
      const parts = path.split('/room/');
      const meetingCode = parts[1] ? parts[1].split('/')[0] : '';
      const token = this.getToken();

      // Ne kayıtlı üye oturumu var ne de misafir jetonu -> doğrudan misafir kayıt sayfasına yönlendir!
      if (!token && !guestToken && meetingCode) {
        window.location.replace(`/guest/${meetingCode}`);
        return;
      }
      return;
    }

    const token = this.getToken();
    if (!token && path !== '/login') {
      window.location.replace('/login');
    }
  },

  getAuthHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  },

  async fetchWithAuth(url, options = {}) {
    options.headers = options.headers || this.getAuthHeaders();
    if (!options.headers['Authorization']) {
      const token = this.getToken();
      if (token) options.headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, options);
    if (response.status === 401 && window.location.pathname !== '/login') {
      const path = window.location.pathname;
      const urlParams = new URLSearchParams(window.location.search);
      const guestToken = urlParams.get('guest_token') || sessionStorage.getItem('guest_token');
      if (path.startsWith('/guest/') || path.startsWith('/room/') || guestToken) {
        return response;
      }
      console.warn("Oturum süresi doldu veya yetkisiz erişim (401). Giriş sayfasına yönlendiriliyor.");
      this.logout();
      throw new Error("Oturum süreniz doldu. Lütfen tekrar giriş yapın.");
    }
    return response;
  },

  initTheme() {
    const theme = localStorage.getItem('theme') || 'light';
    const icon = document.getElementById('themeToggleIcon');
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
      if (icon) icon.className = 'fas fa-sun';
    } else {
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
      if (icon) icon.className = 'fas fa-moon';
    }
  },

  toggleTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    const icon = document.getElementById('themeToggleIcon');
    if (isDark) {
      document.body.classList.remove('dark-theme');
      document.body.classList.add('light-theme');
      localStorage.setItem('theme', 'light');
      if (icon) icon.className = 'fas fa-moon';
    } else {
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
      localStorage.setItem('theme', 'dark');
      if (icon) icon.className = 'fas fa-sun';
    }
  },

  handleGlobalSearch(e) {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (!val) return;
      if (window.location.pathname === '/meetings') {
        const filterInput = document.getElementById('filterSearch');
        if (filterInput) {
          filterInput.value = val;
          if (typeof Meetings !== 'undefined' && Meetings.applyFilters) {
            Meetings.applyFilters();
          }
        }
      } else {
        window.location.href = `/meetings?search=${encodeURIComponent(val)}`;
      }
    }
  },

  updateNavigationPermissions() {
    const user = this.getUser();
    if (!user) return;

    const isAdmin = Boolean(user.role === 'admin' || user.role === 'manager' || user.role === 'host' || user.is_superuser);
    const historyNavItem = document.getElementById('navItemHistory') || document.querySelector('a[href="/history"]');

    if (historyNavItem) {
      historyNavItem.style.display = isAdmin ? 'flex' : 'none';
    }
  },

  updateUserBadge() {
    const user = this.getUser();
    if (!user) return;

    const initialsEl = document.getElementById('userInitials');
    const avatarImgEl = document.getElementById('userAvatarImg');
    const nameEl = document.getElementById('userName');
    const roleBadgeEl = document.getElementById('userRoleBadge');

    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
    const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '') || 'U';
    const isAdmin = (user.role === 'admin' || user.role === 'manager' || user.role === 'host');

    if (nameEl) nameEl.textContent = fullName;
    if (roleBadgeEl) {
      roleBadgeEl.textContent = isAdmin ? 'Yönetici' : 'Katılımcı';
      roleBadgeEl.className = `role-badge ${isAdmin ? 'role-badge-admin' : 'role-badge-user'}`;
    }

    if (user.avatar_url && avatarImgEl) {
      avatarImgEl.src = user.avatar_url;
      avatarImgEl.style.display = 'block';
      if (initialsEl) initialsEl.style.display = 'none';
    } else {
      if (avatarImgEl) avatarImgEl.style.display = 'none';
      if (initialsEl) {
        initialsEl.textContent = initials.toUpperCase();
        initialsEl.style.display = 'flex';
      }
    }

    this.updateNavigationPermissions();
  },

  async fetchUserProfile() {
    const token = this.getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/v1/users/me', {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const user = await res.json();
        localStorage.setItem('user_info', JSON.stringify(user));
        this.updateUserBadge();
      }
    } catch (err) {
      console.warn('Profil bilgisi alnamadı:', err);
    }
  },

  async checkActiveLiveMeeting() {
    const token = this.getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/v1/meetings/active/live', {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const meetings = await res.json();
        const badge = document.getElementById('liveMeetingBadge');
        const text = document.getElementById('liveMeetingText');
        if (badge && meetings && meetings.length > 0) {
          const firstMeeting = meetings[0];
          badge.style.display = 'flex';
          badge.dataset.meetingCode = firstMeeting.meeting_code;
          if (text) text.textContent = `Canlı Toplantı: ${firstMeeting.title}`;
        } else if (badge) {
          badge.style.display = 'none';
        }
      }
    } catch (err) {
      console.warn('Canlı toplantı kontrol hatası:', err);
    }
  },

  joinLiveMeeting() {
    const badge = document.getElementById('liveMeetingBadge');
    if (badge && badge.dataset.meetingCode) {
      window.location.href = `/room/${badge.dataset.meetingCode}`;
    }
  },

  openProfileModal() {
    const user = this.getUser();
    if (!user) return;

    const modal = document.getElementById('profileModal');
    if (!modal) return;

    document.getElementById('profFirstName').value = user.first_name || '';
    document.getElementById('profLastName').value = user.last_name || '';
    document.getElementById('profEmail').value = user.email || '';
    document.getElementById('profUserCode').value = user.user_code || '';
    document.getElementById('profCurrentPass').value = '';
    document.getElementById('profNewPass').value = '';

    const imgPreview = document.getElementById('modalAvatarPreview');
    const initPreview = document.getElementById('modalInitialsPreview');

    if (user.avatar_url && imgPreview) {
      imgPreview.src = user.avatar_url;
      imgPreview.style.display = 'block';
      if (initPreview) initPreview.style.display = 'none';
    } else {
      if (imgPreview) imgPreview.style.display = 'none';
      if (initPreview) {
        const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '') || 'U';
        initPreview.textContent = initials.toUpperCase();
        initPreview.style.display = 'flex';
      }
    }

    modal.style.display = 'flex';
  },

  closeProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) modal.style.display = 'none';
  },

  async handleAvatarUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/v1/users/me/avatar', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getToken()}`
        },
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || 'Avatar yükleme başarısız.');
        return;
      }

      const updatedUser = await res.json();
      localStorage.setItem('user_info', JSON.stringify(updatedUser));
      this.updateUserBadge();

      const imgPreview = document.getElementById('modalAvatarPreview');
      const initPreview = document.getElementById('modalInitialsPreview');
      if (imgPreview) {
        imgPreview.src = updatedUser.avatar_url;
        imgPreview.style.display = 'block';
      }
      if (initPreview) initPreview.style.display = 'none';

      if (window.Notifications) {
        Notifications.showToast('Profil fotoğrafınız başarıyla güncellendi.', 'success');
      } else {
        alert('Profil fotoğrafınız güncellendi.');
      }
    } catch (err) {
      console.error(err);
      alert('Avatar yükleme hatası oluştu.');
    }
  },

  async saveProfile(event) {
    event.preventDefault();

    const firstName = document.getElementById('profFirstName').value.trim();
    const lastName = document.getElementById('profLastName').value.trim();
    const email = document.getElementById('profEmail').value.trim();
    const userCode = document.getElementById('profUserCode').value.trim();
    const currentPassword = document.getElementById('profCurrentPass').value;
    const newPassword = document.getElementById('profNewPass').value;

    const payload = {
      first_name: firstName,
      last_name: lastName,
      email: email,
      user_code: userCode
    };

    if (newPassword) {
      if (!currentPassword) {
        alert('Şifre değiştirmek için mevcut şifrenizi giriniz.');
        return;
      }
      payload.current_password = currentPassword;
      payload.new_password = newPassword;
    }

    try {
      const res = await fetch('/api/v1/users/me', {
        method: 'PUT',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || 'Profil güncelleme başarısız.');
        return;
      }

      const updatedUser = await res.json();
      localStorage.setItem('user_info', JSON.stringify(updatedUser));
      this.updateUserBadge();
      this.closeProfileModal();

      if (window.Notifications) {
        Notifications.showToast('Profil bilgileriniz güncellendi.', 'success');
      } else {
        alert('Profil bilgileriniz güncellendi.');
      }
    } catch (err) {
      console.error(err);
      alert('Profil güncellenirken hata oluştu.');
    }
  }
};

// Sayfa yüklendiğinde otomatik güvenlik kontrolü ve tema ayarı
document.addEventListener('DOMContentLoaded', () => {
  Auth.initTheme();
  Auth.requireAuth();
  Auth.updateUserBadge();
  Auth.fetchUserProfile();
  Auth.checkActiveLiveMeeting();
  setInterval(() => Auth.checkActiveLiveMeeting(), 15000);
});

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

  saveAuth(token, user) {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user_info', JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_info');
    window.location.href = '/login';
  },

  requireAuth() {
    const token = this.getToken();
    if (!token && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  },

  getAuthHeaders() {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    };
  },

  initTheme() {
    const theme = localStorage.getItem('theme') || 'dark';
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  },

  toggleTheme() {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  },

  updateUserBadge() {
    const user = this.getUser();
    if (!user) return;

    const initialsEl = document.getElementById('userInitials');
    const nameEl = document.getElementById('userName');

    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
    const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '') || 'U';

    if (initialsEl) initialsEl.textContent = initials.toUpperCase();
    if (nameEl) nameEl.textContent = fullName;
  }
};

// Sayfa yüklendiğinde otomatik güvenlik kontrolü ve tema ayarı
document.addEventListener('DOMContentLoaded', () => {
  Auth.initTheme();
  Auth.requireAuth();
  Auth.updateUserBadge();
});

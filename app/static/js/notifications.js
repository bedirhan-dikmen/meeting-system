/* ==========================================================================
   NOTIFICATION SYSTEM MODULE
   ========================================================================== */

const Notifications = {
  container: null,

  init() {
    this.container = document.getElementById('toastContainer');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toastContainer';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
    this.fetchNotifications();
  },

  show(message, type = 'info', title = 'Bildirim') {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'danger' || type === 'error') iconClass = 'fa-exclamation-circle';
    if (type === 'warning') iconClass = 'fa-bell';

    toast.innerHTML = `
      <i class="fas ${iconClass}" style="font-size: 1.25rem;"></i>
      <div>
        <strong style="display: block; font-size: 0.9rem;">${title}</strong>
        <span style="font-size: 0.85rem; color: var(--text-secondary);">${message}</span>
      </div>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  showAction(message, buttonText, onButtonClick, type = 'success', title = 'İzin Onaylandı') {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = 'display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem; width: 320px; z-index: 9999; box-shadow: 0 10px 25px rgba(0,0,0,0.15); border-left: 4px solid #107c41;';

    toast.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
        <i class="fas fa-check-circle" style="font-size: 1.4rem; color: #107c41; margin-top: 0.15rem;"></i>
        <div>
          <strong style="display: block; font-size: 0.92rem; color: #0f172a;">${title}</strong>
          <span style="font-size: 0.84rem; color: #475569; line-height: 1.3; display: block;">${message}</span>
        </div>
      </div>
      <button id="toastActionBtn" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 6px; padding: 0.55rem 1rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.4rem; transition: background 0.15s ease;">
        <i class="fas fa-desktop"></i> ${buttonText}
      </button>
    `;

    this.container.appendChild(toast);

    const btn = toast.querySelector('button');
    if (btn) {
      btn.addEventListener('click', () => {
        toast.remove();
        if (typeof onButtonClick === 'function') {
          onButtonClick();
        }
      });
    }

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, 20000);
  },

  async fetchNotifications() {
    // Oturum açmış kayıtlı bir kullanıcı token'ı yoksa (misafir vs.) bildirim çekme
    if (typeof Auth === 'undefined' || !Auth.getToken()) {
      return;
    }
    try {
      const response = await Auth.fetchWithAuth('/api/v1/notifications/');

      if (!response.ok) {
        throw new Error("Bildirimler yüklenemedi.");
      }

      this.notifications = await response.json();
      this.updateBadge();
      this.renderDropdownList(this.notifications);
    } catch (err) {
      console.warn("Bildirimler yüklenirken hata oluştu:", err);
    }
  },

  updateBadge() {
    const unreadCount = this.notifications.filter(n => !n.is_read).length;
    const badge = document.getElementById('notifBadgeCount');
    if (badge) {
        if (unreadCount > 0) {
          badge.textContent = unreadCount;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }
  },

  renderDropdownList(data) {
    const listEl = document.getElementById('notifListContainer');
    if (!listEl) return;

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1rem 0;">Yeni bildiriminiz bulunmuyor.</p>`;
      return;
    }

    listEl.innerHTML = data.slice(0, 5).map(n => `
      <div style="padding: 0.6rem; border-radius: 8px; background: ${n.is_read ? 'transparent' : 'rgba(99, 102, 241, 0.08)'}; border-left: 3px solid ${n.is_read ? 'transparent' : '#6366f1'}; font-size: 0.82rem;">
        <strong style="display: block; color: var(--text-primary); margin-bottom: 0.15rem;">${n.title || 'Bildirim'}</strong>
        <span style="color: var(--text-secondary); line-height: 1.3; display: block;">${n.message || ''}</span>
      </div>
    `).join('');
  },

  toggleDropdown() {
    const menu = document.getElementById('notifDropdownMenu');
    if (!menu) return;
    const isHidden = menu.style.display === 'none';
    menu.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      this.fetchNotifications();
    }
  },

  async markAllRead() {
    try {
      await fetch('/api/v1/notifications/read-all', {
        method: 'POST',
        headers: Auth.getAuthHeaders()
      });
      await this.fetchNotifications();
      this.show('Tüm bildirimler okundu olarak işaretlendi.', 'success', 'Bildirim');
    } catch (e) {
      console.warn("Mark all read failed:", e);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Notifications.init();
  document.addEventListener('click', (e) => {
    const notifContainer = e.target.closest('#notifDropdownMenu, button[title="Bildirimler"]');
    if (!notifContainer) {
      const menu = document.getElementById('notifDropdownMenu');
      if (menu) menu.style.display = 'none';
    }
  });
});

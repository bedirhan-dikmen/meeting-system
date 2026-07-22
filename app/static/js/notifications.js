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

  async fetchNotifications() {
    try {
      const response = await fetch('/api/v1/notifications/', {
        headers: Auth.getAuthHeaders()
      });
      if (!response.ok) return;

      const data = await response.json();
      const unreadCount = data.filter(n => !n.is_read).length;
      
      const badge = document.getElementById('notifBadgeCount');
      if (badge) {
        if (unreadCount > 0) {
          badge.textContent = unreadCount;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (err) {
      console.warn("Bildirimler yüklenemedi:", err);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Notifications.init();
});

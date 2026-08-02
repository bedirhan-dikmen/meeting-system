/* ==========================================================================
   NOTIFICATION SYSTEM MODULE
   ========================================================================== */

const Notifications = {
  container: null,
  recentToastMap: new Map(),

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

    // 1. Deduplication: Suppress identical toast within 2.5 seconds
    const key = `${type}:${title}:${message}`;
    const now = Date.now();
    if (this.recentToastMap.has(key) && (now - this.recentToastMap.get(key)) < 2500) {
      return; // Ignore duplicate spam call
    }
    this.recentToastMap.set(key, now);

    if (this.recentToastMap.size > 50) {
      this.recentToastMap.clear();
    }

    // 2. Max Active Toasts Cap (Max 3 visible toasts in container)
    const existingToasts = this.container.querySelectorAll('.toast');
    if (existingToasts.length >= 3) {
      const oldest = existingToasts[0];
      if (oldest) oldest.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'danger' || type === 'error') iconClass = 'fa-exclamation-circle';
    if (type === 'warning') iconClass = 'fa-bell';

    toast.innerHTML = `
      <i class="fas ${iconClass}" style="font-size: 1.15rem;"></i>
      <div>
        <strong style="display: block; font-size: 0.88rem; color: #0f172a;">${title}</strong>
        <span style="font-size: 0.82rem; color: #475569; line-height: 1.3;">${message}</span>
      </div>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.25s ease';
        setTimeout(() => {
          if (toast.parentNode) toast.remove();
        }, 250);
      }
    }, 4000);
  },

  showAction(message, buttonText, onButtonClick, type = 'success', title = 'İzin Onaylandı') {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = 'display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem; width: 340px; z-index: 99999999 !important; box-shadow: 0 12px 30px rgba(15,23,42,0.18); border-left: 4px solid #107c41; border-radius: 12px; background: #ffffff;';

    toast.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 0.75rem;">
        <i class="fas fa-check-circle" style="font-size: 1.4rem; color: #107c41; margin-top: 0.15rem;"></i>
        <div>
          <strong style="display: block; font-size: 0.92rem; color: #0f172a;">${title}</strong>
          <span style="font-size: 0.84rem; color: #475569; line-height: 1.3; display: block;">${message}</span>
        </div>
      </div>
      <button id="toastActionBtn" style="background: #5b5fc7; color: #ffffff; border: none; border-radius: 8px; padding: 0.55rem 1rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.4rem; transition: background 0.15s ease;">
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

  showGuestRequest(guestName, guestId, onApprove, onDeny) {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = 'toast toast-teams-request';
    toast.style.cssText = 'display: flex; flex-direction: column; gap: 0.85rem; padding: 1.15rem; width: 360px; z-index: 99999999 !important; background: #ffffff !important; border: 1.5px solid #cbd5e1 !important; border-left: 4px solid #5b5fc7 !important; border-radius: 14px !important; box-shadow: 0 14px 35px rgba(15,23,42,0.2) !important;';

    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.85rem;">
        <div style="width: 42px; height: 42px; border-radius: 50%; background: #e0e7ff; color: #5b5fc7; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.1rem; border: 1px solid #c7d2fe;">
          <i class="fas fa-user-plus"></i>
        </div>
        <div style="flex: 1;">
          <strong style="display: block; font-size: 0.95rem; color: #0f172a; font-weight: 800;">Lobi Katılım İsteği</strong>
          <span style="font-size: 0.85rem; color: #475569; display: block; margin-top: 0.1rem;"><strong style="color: #0f172a;">${guestName}</strong> odaya katılmak istiyor.</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 0.6rem; margin-top: 0.2rem;">
        <button class="btn-deny-guest" style="flex: 1; background: #f87171; color: #ffffff; border: none; border-radius: 8px; padding: 0.6rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.18s;">
          <i class="fas fa-times"></i> Reddet
        </button>
        <button class="btn-approve-guest" style="flex: 1; background: #5b5fc7; color: #ffffff; border: none; border-radius: 8px; padding: 0.6rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.18s;">
          <i class="fas fa-check"></i> Odaya Al
        </button>
      </div>
    `;

    this.container.appendChild(toast);

    const denyBtn = toast.querySelector('.btn-deny-guest');
    const approveBtn = toast.querySelector('.btn-approve-guest');

    if (denyBtn) {
      denyBtn.addEventListener('click', () => {
        toast.remove();
        if (typeof onDeny === 'function') onDeny(guestId);
      });
    }

    if (approveBtn) {
      approveBtn.addEventListener('click', () => {
        toast.remove();
        if (typeof onApprove === 'function') onApprove(guestId);
      });
    }

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, 30000);
  },

  showScreenShareRequest(userName, userId, onApprove, onDeny) {
    if (!this.container) this.init();

    const toast = document.createElement('div');
    toast.className = 'toast toast-teams-request';
    toast.style.cssText = 'display: flex; flex-direction: column; gap: 0.85rem; padding: 1.15rem; width: 360px; z-index: 99999999 !important; background: #ffffff !important; border: 1.5px solid #cbd5e1 !important; border-left: 4px solid #0ea5e9 !important; border-radius: 14px !important; box-shadow: 0 14px 35px rgba(15,23,42,0.2) !important;';

    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.85rem;">
        <div style="width: 42px; height: 42px; border-radius: 50%; background: #e0f2fe; color: #0284c7; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.1rem; border: 1px solid #bae6fd;">
          <i class="fas fa-desktop"></i>
        </div>
        <div style="flex: 1;">
          <strong style="display: block; font-size: 0.95rem; color: #0f172a; font-weight: 800;">Ekran Paylaşım İsteği</strong>
          <span style="font-size: 0.85rem; color: #475569; display: block; margin-top: 0.1rem;"><strong style="color: #0f172a;">${userName}</strong> ekranını paylaşmak istiyor.</span>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 0.6rem; margin-top: 0.2rem;">
        <button class="btn-deny-share" style="flex: 1; background: #f87171; color: #ffffff; border: none; border-radius: 8px; padding: 0.6rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.18s;">
          <i class="fas fa-times"></i> Reddet
        </button>
        <button class="btn-approve-share" style="flex: 1; background: #5b5fc7; color: #ffffff; border: none; border-radius: 8px; padding: 0.6rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: all 0.18s;">
          <i class="fas fa-check"></i> İzin Ver
        </button>
      </div>
    `;

    this.container.appendChild(toast);

    const denyBtn = toast.querySelector('.btn-deny-share');
    const approveBtn = toast.querySelector('.btn-approve-share');

    if (denyBtn) {
      denyBtn.addEventListener('click', () => {
        toast.remove();
        if (typeof onDeny === 'function') onDeny(userId);
      });
    }

    if (approveBtn) {
      approveBtn.addEventListener('click', () => {
        toast.remove();
        if (typeof onApprove === 'function') onApprove(userId);
      });
    }

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }
    }, 30000);
  },

  notifications: [],

  async fetchNotifications() {
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
    const unreadCount = (this.notifications || []).filter(n => !n.is_read).length;
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

  extractMeetingCode(message) {
    if (!message) return null;
    const match = message.match(/yeb-[a-z]{4}-[a-z]{4}/i);
    return match ? match[0] : null;
  },

  async handleNotificationClick(notificationId, meetingCode) {
    // Delete/Mark notification as read
    this.deleteNotification(notificationId);

    const code = meetingCode || null;
    if (code) {
      const menu = document.getElementById('notifDropdownMenu');
      if (menu) menu.style.display = 'none';
      window.location.href = `/prejoin/${code}`;
    }
  },

  async deleteNotification(notificationId) {
    try {
      await fetch(`/api/v1/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: (typeof Auth !== 'undefined' && Auth.getAuthHeaders) ? Auth.getAuthHeaders() : {}
      });
      this.notifications = (this.notifications || []).filter(n => String(n.id) !== String(notificationId));
      this.updateBadge();
      this.renderDropdownList(this.notifications);
    } catch (e) {
      console.warn("Bildirim silinirken hata:", e);
    }
  },

  renderDropdownList(data) {
    const listEl = document.getElementById('notifListContainer');
    if (!listEl) return;

    if (!data || data.length === 0) {
      listEl.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1.25rem 0; margin: 0;">Yeni bildiriminiz bulunmuyor.</p>`;
      return;
    }

    listEl.innerHTML = data.slice(0, 10).map(n => {
      const isMeetingInvite = n.title?.includes('Davet') || n.title?.includes('Toplantı') || Boolean(n.meeting_code);
      const meetingCode = n.meeting_code || this.extractMeetingCode(n.message);
      const isRead = n.is_read;

      return `
        <div class="notif-item-card" onclick="Notifications.handleNotificationClick('${n.id}', '${meetingCode || ''}')" style="position: relative; padding: 0.75rem 2.2rem 0.75rem 0.75rem; border-radius: 10px; background: ${isRead ? '#f8fafc' : '#ffffff'}; border: 1px solid ${isRead ? '#e2e8f0' : '#c7d2fe'}; border-left: 4px solid ${isMeetingInvite ? '#5b5fc7' : '#0ea5e9'}; cursor: pointer; transition: all 0.2s ease; margin-bottom: 0.4rem; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
          
          <button type="button" onclick="event.stopPropagation(); Notifications.deleteNotification('${n.id}')" title="Bildirimi Sil" style="position: absolute; top: 6px; right: 8px; background: none; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 2px 6px; border-radius: 4px; line-height: 1; transition: color 0.15s;" onmouseover="this.style.color='#e11d48'" onmouseout="this.style.color='#94a3b8'">
            &times;
          </button>

          <div style="display: flex; align-items: flex-start; gap: 0.65rem;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: ${isMeetingInvite ? '#e0e7ff' : '#e0f2fe'}; color: ${isMeetingInvite ? '#5b5fc7' : '#0ea5e9'}; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 800; flex-shrink: 0; margin-top: 0.1rem;">
              <i class="fas ${isMeetingInvite ? 'fa-video' : 'fa-bell'}"></i>
            </div>
            <div style="flex: 1; overflow: hidden;">
              <strong style="display: block; font-size: 0.84rem; color: #0f172a; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title || 'Bildirim'}</strong>
              <span style="color: #64748b; font-size: 0.78rem; line-height: 1.35; display: block; margin-top: 0.15rem;">${n.message || ''}</span>
              ${meetingCode ? `
                <span style="display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.4rem; color: #5b5fc7; font-weight: 800; font-size: 0.74rem;">
                  <i class="fas fa-sign-in-alt"></i> Toplantı Odasına Katıl &rarr;
                </span>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  toggleDropdown() {
    const menu = document.getElementById('notifDropdownMenu');
    if (!menu) return;
    const isHidden = menu.style.display === 'none' || menu.style.display === '';
    menu.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
      this.fetchNotifications();
    }
  },

  async markAllRead() {
    try {
      await fetch('/api/v1/notifications/clear-all', {
        method: 'POST',
        headers: (typeof Auth !== 'undefined' && Auth.getAuthHeaders) ? Auth.getAuthHeaders() : {}
      });
      this.notifications = [];
      this.updateBadge();
      this.renderDropdownList(this.notifications);
      this.show('Tüm bildirimler silindi.', 'success', 'Bildirimler Temizlendi');
    } catch (e) {
      console.warn("Tüm bildirimleri silme hatası:", e);
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

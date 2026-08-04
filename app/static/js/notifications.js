/* ==========================================================================
   NOTIFICATION SYSTEM MODULE
   ========================================================================== */

const Notifications = {
  container: null,          // Bottom-Right container for standard toasts
  approvalContainer: null,  // Top-Center container for approval banners
  recentToastMap: new Map(),

  init() {
    // 1. Bottom-Right Toast Container (Informational Toasts)
    this.container = document.getElementById('toastContainer');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toastContainer';
      this.container.className = 'toast-container-bottom-right';
      document.body.appendChild(this.container);
    } else {
      this.container.className = 'toast-container-bottom-right';
    }

    // 2. Top-Center Approval Container (Approval & Action Banners)
    this.approvalContainer = document.getElementById('approvalContainer');
    if (!this.approvalContainer) {
      this.approvalContainer = document.createElement('div');
      this.approvalContainer.id = 'approvalContainer';
      this.approvalContainer.className = 'toast-container-top-center';
      document.body.appendChild(this.approvalContainer);
    }

    this.fetchNotifications();
  },

  // -------------------------------------------------------------------------
  // 1. STANDARD INFORMATIONAL TOASTS (BOTTOM-RIGHT, MAX 3, STACK SHIFT, FADE 3RD)
  // -------------------------------------------------------------------------
  show(message, type = 'info', title = 'Bildirim', duration = 4500) {
    if (!this.container) this.init();

    // Spam deduplication check
    const key = `${type}:${title}:${message}`;
    const now = Date.now();
    if (this.recentToastMap.has(key) && (now - this.recentToastMap.get(key)) < 2200) {
      return;
    }
    this.recentToastMap.set(key, now);
    if (this.recentToastMap.size > 40) this.recentToastMap.clear();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} toast-enter`;

    let iconClass = 'fa-info-circle';
    let iconBg = '#e0e7ff';
    let iconColor = '#5b5fc7';

    if (type === 'success') {
      iconClass = 'fa-check-circle';
      iconBg = '#d1fae5';
      iconColor = '#10b981';
    } else if (type === 'danger' || type === 'error') {
      iconClass = 'fa-exclamation-circle';
      iconBg = '#fee2e2';
      iconColor = '#ef4444';
    } else if (type === 'warning') {
      iconClass = 'fa-bell';
      iconBg = '#fef3c7';
      iconColor = '#f59e0b';
    }

    toast.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 0.75rem; flex: 1; min-width: 0;">
        <div style="width: 34px; height: 34px; border-radius: 9px; background: ${iconBg}; color: ${iconColor}; display: flex; align-items: center; justify-content: center; font-size: 1.05rem; flex-shrink: 0; margin-top: 0.05rem;">
          <i class="fas ${iconClass}"></i>
        </div>
        <div style="flex: 1; min-width: 0; padding-right: 0.5rem;">
          <strong style="display: block; font-size: 0.88rem; color: #0f172a; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</strong>
          <span style="display: block; font-size: 0.81rem; color: #475569; line-height: 1.35; margin-top: 0.15rem; word-break: break-word;">${message}</span>
        </div>
      </div>
      <button type="button" class="toast-close-btn" title="Kapat" aria-label="Kapat">&times;</button>
    `;

    // Manual Close Button Event
    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissToast(toast);
      });
    }

    this.container.appendChild(toast);

    // Smooth enter transition
    requestAnimationFrame(() => {
      toast.classList.remove('toast-enter');
    });

    // Enforce Max 3 Active Stack Rule & Fading:
    this.updateToastStack();

    // Auto-dismiss timer
    if (duration > 0) {
      toast.autoDismissTimer = setTimeout(() => {
        this.dismissToast(toast);
      }, duration);
    }
  },

  dismissToast(toast, immediate = false) {
    if (!toast || toast.isDismissing) return;
    toast.isDismissing = true;
    if (toast.autoDismissTimer) clearTimeout(toast.autoDismissTimer);

    if (immediate) {
      toast.remove();
      this.updateToastStack();
      return;
    }

    toast.style.opacity = '0';
    toast.style.transform = 'translateX(60px)';
    toast.style.transition = 'all 0.22s cubic-bezier(0.4, 0, 0.2, 1)';
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
      this.updateToastStack();
    }, 220);
  },

  updateToastStack() {
    if (!this.container) return;
    // Container has flex-direction: column-reverse;
    // Querying toasts: index 0 is NEWEST (bottom), higher indices are OLDEST (top)
    const toasts = Array.from(this.container.querySelectorAll('.toast:not(.is-dismissing)'));

    // Rule 1: Max 3 active toasts. If 4th (or more) arrives, remove the oldest (highest index)
    while (toasts.length > 3) {
      const oldest = toasts.pop();
      if (oldest) this.dismissToast(oldest, true);
    }

    // Rule 2: If 3 toasts exist, index 2 (3rd / oldest visible) becomes faded (opacity 0.5)
    toasts.forEach((t, idx) => {
      if (idx === 2) {
        t.classList.add('toast-faded');
      } else {
        t.classList.remove('toast-faded');
      }
    });
  },

  // -------------------------------------------------------------------------
  // 2. APPROVAL & ACTION NOTIFICATIONS (TOP-CENTER SLIDE DOWN BANNERS)
  // -------------------------------------------------------------------------
  showApproval({ title, message, icon = 'fa-user-check', iconBg = '#e0e7ff', iconColor = '#5b5fc7', approveText = 'Kabul Et', denyText = 'Reddet', onApprove, onDeny, duration = 30000 }) {
    if (!this.approvalContainer) this.init();

    const toast = document.createElement('div');
    toast.className = 'approval-toast approval-toast-enter';

    toast.innerHTML = `
      <button type="button" class="approval-close-btn" title="Kapat">&times;</button>
      <div style="display: flex; align-items: flex-start; gap: 0.85rem;">
        <div style="width: 42px; height: 42px; border-radius: 12px; background: ${iconBg}; color: ${iconColor}; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.15rem; flex-shrink: 0;">
          <i class="fas ${icon}"></i>
        </div>
        <div style="flex: 1; padding-right: 1.2rem;">
          <strong style="display: block; font-size: 0.95rem; color: #0f172a; font-weight: 800;">${title}</strong>
          <span style="font-size: 0.84rem; color: #475569; display: block; margin-top: 0.2rem; line-height: 1.4;">${message}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 0.65rem; margin-top: 0.85rem; padding-top: 0.75rem; border-top: 1px solid #f1f5f9;">
        ${denyText ? `
          <button type="button" class="btn-approval-deny" style="flex: 1; height: 36px; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1; border-radius: 9px; font-weight: 700; font-size: 0.84rem; cursor: pointer; transition: all 0.18s; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
            <i class="fas fa-times"></i> ${denyText}
          </button>
        ` : ''}
        <button type="button" class="btn-approval-accept" style="flex: 1; height: 36px; background: linear-gradient(135deg, #5b5fc7 0%, #4f46e5 100%); color: #ffffff; border: none; border-radius: 9px; font-weight: 700; font-size: 0.84rem; cursor: pointer; box-shadow: 0 4px 12px rgba(91, 95, 199, 0.3); transition: all 0.18s; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
          <i class="fas fa-check"></i> ${approveText}
        </button>
      </div>
    `;

    const dismiss = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px) scale(0.95)';
      toast.style.transition = 'all 0.22s ease';
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 220);
    };

    const closeBtn = toast.querySelector('.approval-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);

    const denyBtn = toast.querySelector('.btn-approval-deny');
    if (denyBtn) {
      denyBtn.addEventListener('click', () => {
        dismiss();
        if (typeof onDeny === 'function') onDeny();
      });
    }

    const acceptBtn = toast.querySelector('.btn-approval-accept');
    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        dismiss();
        if (typeof onApprove === 'function') onApprove();
      });
    }

    this.approvalContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('approval-toast-enter');
    });

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  },

  showGuestRequest(guestName, guestId, onApprove, onDeny) {
    this.showApproval({
      title: 'Lobi Katılım Talebi',
      message: `<strong style="color: #0f172a;">${guestName}</strong> odaya katılmak istiyor.`,
      icon: 'fa-user-plus',
      iconBg: '#e0e7ff',
      iconColor: '#5b5fc7',
      approveText: 'Odaya Al',
      denyText: 'Reddet',
      onApprove: () => onApprove && onApprove(guestId),
      onDeny: () => onDeny && onDeny(guestId)
    });
  },

  showScreenShareRequest(userName, userId, onApprove, onDeny) {
    this.showApproval({
      title: 'Ekran Paylaşım Talebi',
      message: `<strong style="color: #0f172a;">${userName}</strong> ekranını paylaşmak istiyor.`,
      icon: 'fa-desktop',
      iconBg: '#e0f2fe',
      iconColor: '#0284c7',
      approveText: 'İzin Ver',
      denyText: 'Reddet',
      onApprove: () => onApprove && onApprove(userId),
      onDeny: () => onDeny && onDeny(userId)
    });
  },

  showAction(message, buttonText, onButtonClick, type = 'success', title = 'İzin Onaylandı') {
    this.showApproval({
      title: title,
      message: message,
      icon: 'fa-check-circle',
      iconBg: '#d1fae5',
      iconColor: '#10b981',
      approveText: buttonText,
      denyText: null,
      onApprove: onButtonClick
    });
  },

  // -------------------------------------------------------------------------
  // 3. PERSISTENT NOTIFICATION DROPDOWN MENU & API SYNC
  // -------------------------------------------------------------------------
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

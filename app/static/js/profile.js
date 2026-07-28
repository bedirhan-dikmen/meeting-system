/* ==========================================================================
   PROFILE PAGE CONTROLLER MODULE
   ========================================================================== */

const ProfilePage = {
  meetingsHistory: [],

  async init() {
    Auth.requireAuth();
    await this.loadOverview();
  },

  async loadOverview() {
    let user = Auth.getUser() || {};
    let stats = { total_meetings: 0, total_duration_minutes: 0, reports_count: 0 };

    try {
      try {
        const res = await Auth.fetchWithAuth('/api/v1/users/me/profile-overview');

        if (res.ok) {
          const data = await res.json();
          if (data.user_info) user = data.user_info;
          if (data.stats) stats = data.stats;
          this.meetingsHistory = data.meetings_history || [];
        }
      } catch (err) {
        console.warn("Profil özet servisine erişilemedi, yerel veri kullanılıyor:", err);
      }

      // User Header Fill
      const nameEl = document.getElementById('profileHeaderName');
      const emailEl = document.getElementById('profileHeaderEmail');
      const codeEl = document.getElementById('profileHeaderUserCode');
      const badgeEl = document.getElementById('profileHeaderRoleBadge');
      const avatarImg = document.getElementById('profileHeaderAvatar');
      const initialsEl = document.getElementById('profileHeaderInitials');

      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Kullanıcı';
      const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '') || 'U';
      const isAdmin = (user.role === 'admin' || user.role === 'manager' || user.role === 'host');

      if (nameEl) nameEl.textContent = fullName;
      if (emailEl) emailEl.textContent = user.email || '-';
      if (codeEl) codeEl.textContent = user.user_code || '-';

      if (badgeEl) {
        badgeEl.textContent = isAdmin ? 'Yönetici' : 'Katılımcı';
        badgeEl.className = `role-badge ${isAdmin ? 'role-badge-admin' : 'role-badge-user'}`;
      }

      if (user.avatar_url && avatarImg) {
        avatarImg.src = user.avatar_url;
        avatarImg.style.display = 'block';
        if (initialsEl) initialsEl.style.display = 'none';
      } else if (initialsEl) {
        initialsEl.textContent = initials.toUpperCase();
        initialsEl.style.display = 'flex';
        if (avatarImg) avatarImg.style.display = 'none';
      }

      // Stats Fill
      const totalMeetingsEl = document.getElementById('statProfileTotalMeetings');
      const totalDurationEl = document.getElementById('statProfileTotalDuration');
      const reportsCountEl = document.getElementById('statProfileReportsCount');

      if (totalMeetingsEl) totalMeetingsEl.textContent = stats.total_meetings || 0;
      if (totalDurationEl) totalDurationEl.textContent = `${stats.total_duration_minutes || 0} dk`;
      if (reportsCountEl) reportsCountEl.textContent = stats.reports_count || 0;

      // Render History Table
      this.renderHistoryTable(this.meetingsHistory);
    } catch (err) {
      console.error("Profil yükleme hatası:", err);
    }
  },

  renderHistoryTable(meetings) {
    const tbody = document.getElementById('profileMeetingsTableBody');
    if (!tbody) return;

    if (!meetings || meetings.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
            <i class="fas fa-calendar-check" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.5; color: #5b5fc7;"></i>
            Henüz katıldığınız ve tamamlanmış bir toplantı kaydı bulunmuyor.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = meetings.map(m => {
      const dateStr = m.scheduled_start || m.created_at;
      let parsedDate = null;
      if (dateStr && typeof dateStr === 'string') {
        const cleanStr = dateStr.split('.')[0].replace('Z', '').replace(/[\+\-]\d{2}:\d{2}$/, '');
        const parts = cleanStr.split(/[-T :]/).map(Number);
        if (parts.length >= 5) {
          parsedDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
        } else {
          parsedDate = new Date(dateStr);
        }
      } else if (dateStr) {
        parsedDate = new Date(dateStr);
      }
      const formattedDate = parsedDate ? parsedDate.toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '-';

      const isLive = (m.status === 'ACTIVE' || m.status === 'başladı');
      const isCompleted = (m.status === 'tamamlandı');

      let statusBadgeClass = 'badge-secondary';
      let statusText = m.status;

      if (isLive) {
        statusBadgeClass = 'badge-success';
        statusText = '🔴 Canlı Devam Ediyor';
      } else if (isCompleted) {
        statusBadgeClass = 'badge-info';
        statusText = 'Tamamlandı';
      } else if (m.status === 'planlandı') {
        statusBadgeClass = 'badge-primary';
        statusText = 'Planlandı';
      } else if (m.status === 'iptal edildi') {
        statusBadgeClass = 'badge-danger';
        statusText = 'İptal Edildi';
      }

      return `
        <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s ease;">
          <td style="padding: 1rem;">
            <strong style="color: var(--text-primary); font-size: 0.92rem;">${m.title}</strong>
          </td>
          <td style="padding: 1rem; font-family: monospace; color: #5b5fc7; font-weight: 700;">
            ${m.meeting_code}
          </td>
          <td style="padding: 1rem; color: var(--text-secondary);">
            ${m.meeting_type}
          </td>
          <td style="padding: 1rem; color: var(--text-secondary);">
            ${formattedDate}
          </td>
          <td style="padding: 1rem;">
            <span class="role-badge ${m.is_host ? 'role-badge-admin' : 'role-badge-user'}">
              ${m.is_host ? 'Düzenleyen (Host)' : 'Katılımcı'}
            </span>
          </td>
          <td style="padding: 1rem;">
            <span class="badge ${statusBadgeClass}">${statusText}</span>
          </td>
          <td style="padding: 1rem; text-align: right;">
            <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
              ${isLive ? `
                <a href="/room/${m.meeting_code}" class="btn btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                  <i class="fas fa-door-open"></i> Canlı Odaya Katıl
                </a>
              ` : ''}
              <a href="/reports/${m.id}" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                <i class="fas fa-file-invoice"></i> Resmi Raporu İncele
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  filterMeetings() {
    const q = (document.getElementById('profileMeetingSearch')?.value || '').toLowerCase();
    const filtered = this.meetingsHistory.filter(m =>
      (m.title && m.title.toLowerCase().includes(q)) ||
      (m.meeting_code && m.meeting_code.toLowerCase().includes(q))
    );
    this.renderHistoryTable(filtered);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  ProfilePage.init();
});

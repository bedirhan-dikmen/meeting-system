/* ==========================================================================
   MEETING HISTORY MODULE (Yönetici Paneli Toplantı Geçmişi)
   ========================================================================== */

const History = {
  allHistory: [],

  async init() {
    if (typeof Auth !== 'undefined') {
      Auth.requireAuth();
      const user = Auth.getUser();
      const isAdmin = user && (user.role === 'admin' || user.role === 'manager' || user.role === 'host' || user.is_superuser);
      if (!isAdmin) {
        if (typeof Notifications !== 'undefined') {
          Notifications.show("Kayıtlar sayfası yalnızca yönetici rolüne sahip kullanıcılara özeldir.", "danger", "Yetkisiz Erişim");
        }
        setTimeout(() => {
          window.location.replace('/profile');
        }, 1000);
        return;
      }
    }
    await this.fetchHistory();
  },

  async refresh() {
    const tableBody = document.getElementById('historyTableBody');
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 3rem; text-align: center; color: var(--text-muted);">
            <i class="fas fa-spinner fa-spin" style="font-size: 1.8rem; color: #6366f1; margin-bottom: 0.5rem; display: block;"></i>
            Veriler yenileniyor...
          </td>
        </tr>
      `;
    }
    await this.fetchHistory();
  },

  async fetchHistory() {
    try {
      const res = await fetch('/api/v1/meetings/past/history', {
        headers: Auth.getAuthHeaders()
      });

      if (!res.ok) {
        if (res.status === 403) {
          if (typeof Notifications !== 'undefined') {
            Notifications.show("Kayıtlar arşivine erişim yetkiniz bulunmuyor. Profilinize yönlendiriliyorsunuz.", "danger", "Yetkisiz Erişim");
          }
          setTimeout(() => {
            window.location.replace('/profile');
          }, 1000);
          return;
        }
        throw new Error("Toplantı geçmişi yüklenirken bir hata oluştu.");
      }

      this.allHistory = await res.json();
      this.updateStats(this.allHistory);
      this.applyFilters();
    } catch (err) {
      console.error(err);
      const tableBody = document.getElementById('historyTableBody');
      if (tableBody) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" style="padding: 2.5rem; text-align: center; color: var(--accent-rose, #ef4444);">
              <i class="fas fa-exclamation-triangle" style="font-size: 1.8rem; margin-bottom: 0.5rem; display: block;"></i>
              ${err.message || 'Veriler yüklenemedi.'}
            </td>
          </tr>
        `;
      }
    }
  },

  parseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr === 'string') {
      const cleanStr = dateStr.split('.')[0].replace('Z', '').replace(/[\+\-]\d{2}:\d{2}$/, '');
      const parts = cleanStr.split(/[-T :]/).map(Number);
      if (parts.length >= 5) {
        return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
      }
    }
    return new Date(dateStr);
  },

  updateStats(list) {
    const completedList = list.filter(m => (m.status || '').toLowerCase() === 'tamamlandı');
    
    let totalSessions = 0;
    let totalNotesActions = 0;
    let totalMinutes = 0;

    list.forEach(m => {
      totalSessions += (m.sessions_count || 0);
      totalNotesActions += ((m.notes_count || 0) + (m.actions_count || 0));
      totalMinutes += (m.duration_minutes || 0);
    });

    const elCompleted = document.getElementById('statCompletedCount');
    const elSessions = document.getElementById('statSessionsCount');
    const elDuration = document.getElementById('statTotalDuration');
    const elNotesActions = document.getElementById('statNotesActionsCount');

    if (elCompleted) elCompleted.textContent = completedList.length || list.length;
    if (elSessions) elSessions.textContent = totalSessions;
    if (elNotesActions) elNotesActions.textContent = totalNotesActions;

    if (elDuration) {
      if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        elDuration.textContent = `${hours} sa ${mins} dk`;
      } else {
        elDuration.textContent = `${totalMinutes} dk`;
      }
    }
  },

  applyFilters() {
    const searchVal = (document.getElementById('histSearchInput')?.value || '').toLowerCase().trim();
    const dateFrom = document.getElementById('histDateFrom')?.value || '';
    const dateTo = document.getElementById('histDateTo')?.value || '';
    const typeVal = document.getElementById('histTypeFilter')?.value || '';
    const statusVal = document.getElementById('histStatusFilter')?.value || '';

    const filtered = this.allHistory.filter(m => {
      if (searchVal) {
        const titleMatch = (m.title || '').toLowerCase().includes(searchVal);
        const codeMatch = (m.meeting_code || '').toLowerCase().includes(searchVal);
        const creatorMatch = (m.creator_name || '').toLowerCase().includes(searchVal);
        if (!titleMatch && !codeMatch && !creatorMatch) return false;
      }

      if (typeVal && m.meeting_type !== typeVal) return false;
      if (statusVal && m.status !== statusVal) return false;

      const startDateObj = this.parseDate(m.actual_start || m.scheduled_start || m.created_at);
      if (startDateObj) {
        if (dateFrom && startDateObj < new Date(dateFrom)) return false;
        if (dateTo && startDateObj > new Date(dateTo + 'T23:59:59')) return false;
      }

      return true;
    });

    this.renderTable(filtered);
  },

  renderTable(list) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="padding: 2.5rem; text-align: center; color: var(--text-muted);">
            <i class="fas fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; display: block; opacity: 0.4;"></i>
            Kriterlere uygun geçmiş toplantı kaydı bulunamadı.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(m => {
      const startObj = this.parseDate(m.actual_start || m.scheduled_start || m.created_at);
      const formattedDate = startObj ? startObj.toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }) : '-';

      const status = (m.status || '').toLowerCase();
      let statusBadgeHTML = '';

      if (status === 'tamamlandı' || status === 'completed') {
        statusBadgeHTML = `<span style="background: #d1fae5; border: 1px solid #a7f3d0; color: #065f46; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;"><i class="fas fa-check-circle"></i> Tamamlandı</span>`;
      } else if (status === 'iptal edildi') {
        statusBadgeHTML = `<span style="background: #ffe4e6; border: 1px solid #fecdd3; color: #be123c; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;"><i class="fas fa-ban"></i> İptal Edildi</span>`;
      } else if (status === 'active' || status === 'başladı' || status === 'canlı') {
        statusBadgeHTML = `<span style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;"><span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; display: inline-block;"></span> Canlı</span>`;
      } else {
        statusBadgeHTML = `<span style="background: #e0f2fe; border: 1px solid #bae6fd; color: #0369a1; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.3rem;"><i class="far fa-calendar-alt"></i> Planlandı</span>`;
      }

      return `
        <tr style="border-bottom: 1px solid var(--border-color, #f1f5f9); transition: background 0.15s ease;">
          <td style="padding: 1rem 1.25rem; font-family: monospace; font-weight: 700; color: #5b5fc7;">
            ${m.meeting_code}
          </td>
          <td style="padding: 1rem 1.25rem;">
            <div style="font-weight: 700; color: var(--text-primary);">${m.title}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem;">${m.meeting_type}</div>
          </td>
          <td style="padding: 1rem 1.25rem; font-weight: 600; color: var(--text-secondary);">
            <i class="fas fa-user-tie" style="color: #94a3b8; margin-right: 0.3rem;"></i>${m.creator_name}
          </td>
          <td style="padding: 1rem 1.25rem; font-weight: 600; color: var(--text-primary);">
            ${formattedDate}
          </td>
          <td style="padding: 1rem 1.25rem; font-weight: 700; color: var(--text-secondary);">
            ${m.duration_minutes || 30} dk
          </td>
          <td style="padding: 1rem 1.25rem;">
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <span style="background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; padding: 0.15rem 0.45rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700;" title="Oturum Kaydı">
                <i class="fas fa-users" style="color: #5b5fc7;"></i> ${m.sessions_count || 0}
              </span>
              <span style="background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; padding: 0.15rem 0.45rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700;" title="Not & Aksiyonlar">
                <i class="fas fa-sticky-note" style="color: #5b5fc7;"></i> ${(m.notes_count || 0) + (m.actions_count || 0)}
              </span>
            </div>
          </td>
          <td style="padding: 1rem 1.25rem;">
            ${statusBadgeHTML}
          </td>
          <td style="padding: 1rem 1.25rem; text-align: right; white-space: nowrap;">
            <div style="display: inline-flex; gap: 0.4rem;">
              <button onclick="History.showModal('${m.id}')" class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; border-radius: 7px;" title="Özet Detay">
                <i class="fas fa-info-circle"></i>
              </button>
              <a href="/reports/${m.id}" class="btn btn-primary" style="padding: 0.4rem 0.85rem; font-size: 0.8rem; border-radius: 7px; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 0.3rem;">
                <i class="fas fa-file-contract"></i> Rapor
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  showModal(meetingId) {
    const m = this.allHistory.find(item => item.id === meetingId);
    if (!m) return;

    const modalTitle = document.getElementById('histModalTitle');
    const modalBody = document.getElementById('histModalBody');
    const reportBtn = document.getElementById('histModalReportBtn');

    if (modalTitle) modalTitle.textContent = m.title || 'Toplantı Detayı';
    if (reportBtn) reportBtn.href = `/reports/${m.id}`;

    const startObj = this.parseDate(m.actual_start || m.scheduled_start || m.created_at);
    const endObj = this.parseDate(m.actual_end || m.scheduled_end);

    const startStr = startObj ? startObj.toLocaleString('tr-TR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
    const endStr = endObj ? endObj.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' }) : '-';

    if (modalBody) {
      modalBody.innerHTML = `
        <div style="background: var(--bg-tertiary, #f8fafc); padding: 0.85rem; border-radius: 10px; border: 1px solid var(--border-color, #e2e8f0);">
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Oda Kodu</div>
          <div style="font-size: 1.1rem; font-weight: 800; color: #6366f1; font-family: monospace;">${m.meeting_code}</div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Düzenleyici / Host</div>
            <div style="font-weight: 700; color: var(--text-primary);">${m.creator_name}</div>
          </div>
          <div>
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Toplantı Türü</div>
            <div style="font-weight: 700; color: var(--text-primary);">${m.meeting_type}</div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div>
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Tarih ve Başlangıç</div>
            <div style="font-weight: 700; color: var(--text-primary);">${startStr}</div>
          </div>
          <div>
            <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Tahmini/Gerçek Bitiş</div>
            <div style="font-weight: 700; color: var(--text-primary);">${endStr} (${m.duration_minutes || 30} dk)</div>
          </div>
        </div>

        <div>
          <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Katılım ve Not İstatistiği</div>
          <div style="font-weight: 700; color: var(--text-primary); margin-top: 0.2rem;">
            ${m.sessions_count || 0} Oturum Girişi • ${m.notes_count || 0} Alınan Not • ${m.actions_count || 0} Aksiyon Kararı
          </div>
        </div>

        <div>
          <div style="font-size: 0.78rem; color: var(--text-muted); font-weight: 600;">Gündem / Açıklama</div>
          <div style="background: var(--bg-primary, #ffffff); border: 1px solid var(--border-color, #e2e8f0); padding: 0.65rem; border-radius: 8px; font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.2rem;">
            ${m.agenda || m.description || 'Toplantı gündemi veya açıklaması eklenmemiş.'}
          </div>
        </div>
      `;
    }

    const modal = document.getElementById('historyDetailsModal');
    if (modal) modal.style.display = 'flex';
  },

  closeModal() {
    const modal = document.getElementById('historyDetailsModal');
    if (modal) modal.style.display = 'none';
  }
};

document.addEventListener('DOMContentLoaded', () => {
  History.init();
});
